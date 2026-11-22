// dnote — DNotes 命令行：按文件名显示笔记内容，或在 vault 中全文搜索。
//
//	dnote <文件名> [--vault <路径>]            显示文件名匹配的笔记（忽略目录；多个匹配全部显示）
//	dnote --search <关键词> [--vault <路径>]   在 vault 内搜索所有匹配行
//	dnote <文件名> --search <关键词>           只在文件名匹配的笔记里搜索
//
// 未指定 --vault 时：当前目录位于某个已知 vault 内则用它，否则用 DNotes 最后打开的 vault。
package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// 与 electron/main.cjs 保持一致
var ignoredDirs = map[string]bool{".git": true, ".dnotes": true, ".obsidian": true, ".trash": true, "node_modules": true}
var mdExt = regexp.MustCompile(`(?i)\.(md|markdown)$`)

const usage = `用法:
  dnote <文件名> [--vault <路径>]             显示笔记内容（按文件名匹配，忽略目录，.md 可省略）
  dnote --search <关键词> [--vault <路径>]    在 vault 中搜索（不区分大小写）
  dnote <文件名> --search <关键词>            只在匹配的笔记中搜索

未指定 --vault 时，优先使用当前目录所在的 vault，否则使用 DNotes 最后打开的 vault。
`

type options struct{ name, vault, search string }

func main() {
	opts, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "dnote: %v\n\n%s", err, usage)
		os.Exit(2)
	}
	root, err := resolveVault(opts.vault)
	if err != nil {
		fail(err)
	}
	files, err := markdownFiles(root)
	if err != nil {
		fail(err)
	}
	if opts.name != "" {
		files = matchName(files, opts.name)
		if len(files) == 0 {
			fmt.Fprintf(os.Stderr, "dnote: 在 %s 中没有找到笔记: %s\n", root, opts.name)
			os.Exit(1)
		}
	}
	color := useColor()
	if opts.search != "" {
		if !search(root, files, opts.search, color) {
			os.Exit(1)
		}
		return
	}
	show(root, files, color)
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "dnote: %v\n", err)
	os.Exit(2)
}

func parseArgs(args []string) (options, error) {
	var o options
	var pos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			pos = append(pos, args[i+1:]...)
			break
		}
		key, val, hasVal := strings.Cut(a, "=")
		switch key {
		case "-h", "--help":
			fmt.Print(usage)
			os.Exit(0)
		case "--vault", "-v", "--search", "-s":
			if !hasVal {
				if i+1 >= len(args) {
					return o, fmt.Errorf("%s 需要一个参数", key)
				}
				i++
				val = args[i]
			}
			if key == "--vault" || key == "-v" {
				o.vault = val
			} else {
				o.search = val
			}
		default:
			if strings.HasPrefix(a, "-") && a != "-" {
				return o, fmt.Errorf("未知选项: %s", a)
			}
			pos = append(pos, a)
		}
	}
	if len(pos) > 1 {
		return o, fmt.Errorf("只能指定一个文件名")
	}
	if len(pos) == 1 {
		o.name = pos[0]
	}
	if o.name == "" && o.search == "" {
		return o, fmt.Errorf("缺少文件名或 --search")
	}
	return o, nil
}

// ---------------------------------------------------------------- vault

type appConfig struct {
	Vaults    []struct{ Path string } `json:"vaults"`
	LastVault string                  `json:"lastVault"`
}

// 读取 DNotes 的 config.json（开发版在 userData/dnotes，打包版可能在 userData/DNotes），取最近修改的那个
func loadConfig() (*appConfig, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	var best *appConfig
	var bestMod int64
	for _, name := range []string{"dnotes", "DNotes"} {
		p := filepath.Join(dir, name, "config.json")
		st, err := os.Stat(p)
		if err != nil || (best != nil && st.ModTime().UnixNano() <= bestMod) {
			continue
		}
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var c appConfig
		if json.Unmarshal(b, &c) != nil {
			continue
		}
		best, bestMod = &c, st.ModTime().UnixNano()
	}
	if best == nil {
		return nil, fmt.Errorf("找不到 DNotes 配置（%s/dnotes/config.json），请用 --vault 指定", dir)
	}
	return best, nil
}

func resolveVault(flag string) (string, error) {
	if flag != "" {
		return checkDir(flag)
	}
	cfg, err := loadConfig()
	if err != nil {
		return "", err
	}
	// 当前目录在某个已知 vault 内：用最深的那个
	if cwd, err := os.Getwd(); err == nil {
		best := ""
		for _, v := range cfg.Vaults {
			if v.Path != "" && within(v.Path, cwd) && len(v.Path) > len(best) {
				best = v.Path
			}
		}
		if best != "" {
			return checkDir(best)
		}
	}
	if cfg.LastVault == "" {
		return "", fmt.Errorf("DNotes 还没有打开过 vault，请用 --vault 指定")
	}
	return checkDir(cfg.LastVault)
}

func within(root, p string) bool {
	r, err := filepath.Rel(root, p)
	return err == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator))
}

func checkDir(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		return "", fmt.Errorf("vault 目录不存在: %s", abs)
	}
	return abs, nil
}

// ---------------------------------------------------------------- 文件

func markdownFiles(root string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 跳过无权限等错误
		}
		if p == root {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") || ignoredDirs[name] {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() && mdExt.MatchString(name) {
			out = append(out, p)
		}
		return nil
	})
	sort.Strings(out)
	return out, err
}

func stem(p string) string { return mdExt.ReplaceAllString(filepath.Base(p), "") }

// 按文件名匹配（忽略目录、不区分大小写、.md 可省略）；没有精确匹配时退化为包含匹配
func matchName(files []string, name string) []string {
	q := stem(name)
	var exact, partial []string
	for _, f := range files {
		s := stem(f)
		switch {
		case strings.EqualFold(s, q):
			exact = append(exact, f)
		case strings.Contains(strings.ToLower(s), strings.ToLower(q)):
			partial = append(partial, f)
		}
	}
	if len(exact) > 0 {
		return exact
	}
	return partial
}

// ---------------------------------------------------------------- 输出

const (
	cHeader = "\x1b[1;36m"
	cPath   = "\x1b[35m"
	cLine   = "\x1b[32m"
	cMatch  = "\x1b[1;31m"
	cReset  = "\x1b[0m"
)

func isTerminal() bool {
	st, err := os.Stdout.Stat()
	return err == nil && st.Mode()&os.ModeCharDevice != 0
}

func useColor() bool { return os.Getenv("NO_COLOR") == "" && isTerminal() }

func paint(on bool, code, s string) string {
	if !on {
		return s
	}
	return code + s + cReset
}

func rel(root, p string) string {
	r, err := filepath.Rel(root, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

func show(root string, files []string, color bool) {
	multi := len(files) > 1
	for i, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "dnote: %v\n", err)
			continue
		}
		if multi {
			if i > 0 {
				fmt.Println()
			}
			fmt.Println(paint(color, cHeader, "==> "+rel(root, f)+" <=="))
		}
		os.Stdout.Write(b)
		// 文件末尾没有换行时补一个（多文件分隔需要；输出到终端时避免 zsh 显示 %），管道输出单文件保持原样
		if (multi || isTerminal()) && len(b) > 0 && b[len(b)-1] != '\n' {
			fmt.Println()
		}
	}
}

func search(root string, files []string, query string, color bool) bool {
	re := regexp.MustCompile("(?i)" + regexp.QuoteMeta(query))
	found := false
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		r := rel(root, f)
		for n, line := range strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n") {
			if !re.MatchString(line) {
				continue
			}
			found = true
			if color {
				line = re.ReplaceAllStringFunc(line, func(s string) string { return cMatch + s + cReset })
			}
			fmt.Printf("%s:%s: %s\n", paint(color, cPath, r), paint(color, cLine, fmt.Sprint(n+1)), line)
		}
	}
	return found
}
