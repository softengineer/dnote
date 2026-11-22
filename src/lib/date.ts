import { t } from './i18n'
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 支持 YYYY YY MM M DD D HH mm ss ddd(星期) */
export function formatDate(d: Date, fmt: string) {
  return fmt.replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss|ddd/g, (tok) => {
    switch (tok) {
      case 'YYYY': return String(d.getFullYear())
      case 'YY': return String(d.getFullYear()).slice(-2)
      case 'MM': return pad(d.getMonth() + 1)
      case 'M': return String(d.getMonth() + 1)
      case 'DD': return pad(d.getDate())
      case 'D': return String(d.getDate())
      case 'HH': return pad(d.getHours())
      case 'mm': return pad(d.getMinutes())
      case 'ss': return pad(d.getSeconds())
      case 'ddd': return t('weekdays').split(',')[d.getDay()]
    }
    return tok
  })
}

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
