/**
 * @description 格式化时间
 */
export function parseTime(time: Date | number | string, cFormat?: string) {
  if (arguments.length === 0) {
    return null
  }
  const format = cFormat || '{y}-{m}-{d} {h}:{i}:{s}'
  let date: Date
  if (typeof time === 'object') {
    date = time as Date
  } else {
    let t: number | string = time
    if (typeof t === 'string' && /^[0-9]+$/.test(t)) {
      t = Number.parseInt(t)
    }
    if (typeof t === 'number' && t.toString().length === 10) {
      t = t * 1000
    }
    date = new Date(t)
  }
  const formatObj: Record<string, number> = {
    y: date.getFullYear(),
    m: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    i: date.getMinutes(),
    s: date.getSeconds(),
    a: date.getDay(),
  }
  return format.replace(/{([ymdhisa])+}/g, (result: string, key: string): string => {
    let value: string | number = formatObj[key] ?? 0
    if (key === 'a') {
      return ['日', '一', '二', '三', '四', '五', '六'][value as number] ?? ''
    }
    if (result.length > 0 && (value as number) < 10) {
      value = `0${value}`
    }
    return `${value || 0}`
  })
}
