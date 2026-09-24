const IPV4_PATTERN = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const MAX_IP_WHITELIST = 20

/** 换行、逗号、分号拆条；起止段里的空格不拆开。 */
function splitIpWhitelist(value) {
  if (value == null || String(value).trim() === '') {
    return []
  }
  const entries = []
  String(value).split(/[,，;；\r\n]+/).forEach((chunk) => {
    const trimmed = chunk.trim()
    if (!trimmed) {
      return
    }
    if (trimmed.includes('-')) {
      entries.push(trimmed)
      return
    }
    trimmed.split(/\s+/).forEach((part) => {
      if (part) {
        entries.push(part)
      }
    })
  })
  return entries
}

function isIpv4(text) {
  return IPV4_PATTERN.test(text)
}

function isIpv6(text) {
  if (!text.includes(':') || !/^[0-9a-fA-F:.]+$/.test(text)) {
    return false
  }
  const compressed = text.indexOf('::')
  return compressed < 0 || text.indexOf('::', compressed + 2) < 0
}

function ipv4ToInt(text) {
  return text.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0)
}

/** 与后端 IpWhitelistUtils 对齐：单 IP、CIDR、起止段、尾部通配。 */
function isValidIpEntry(text) {
  const value = text.trim()
  if (value.includes('/')) {
    const pieces = value.split('/')
    if (pieces.length !== 2 || !/^\d{1,3}$/.test(pieces[1].trim())) {
      return false
    }
    const bits = Number(pieces[1].trim())
    const address = pieces[0].trim()
    if (isIpv4(address)) {
      return bits <= 32
    }
    return isIpv6(address) && bits <= 128
  }
  if (value.includes('-')) {
    const dash = value.indexOf('-')
    if (dash !== value.lastIndexOf('-') || dash <= 0) {
      return false
    }
    const start = value.slice(0, dash).trim()
    const end = value.slice(dash + 1).trim()
    if (isIpv4(start)) {
      if (isIpv4(end)) {
        return ipv4ToInt(start) <= ipv4ToInt(end)
      }
      if (/^\d{1,3}$/.test(end)) {
        const last = Number(end)
        return last <= 255 && last >= Number(start.split('.')[3])
      }
      return false
    }
    return isIpv6(start) && isIpv6(end)
  }
  if (value.includes('*')) {
    const parts = value.split('.')
    if (parts.length !== 4) {
      return false
    }
    let seenStar = false
    let concrete = false
    for (const part of parts) {
      if (part === '*') {
        seenStar = true
        continue
      }
      if (seenStar || !/^\d{1,3}$/.test(part) || Number(part) > 255) {
        return false
      }
      concrete = true
    }
    return concrete && seenStar
  }
  return isIpv4(value) || isIpv6(value)
}

export function ipWhitelistError(value) {
  const unique = [...new Set(splitIpWhitelist(value))]
  if (unique.length > MAX_IP_WHITELIST) {
    return `IP白名单最多${MAX_IP_WHITELIST}条`
  }
  for (const entry of unique) {
    if (!isValidIpEntry(entry)) {
      return `IP白名单格式不正确：${entry}`
    }
  }
  return ''
}

export function formatIpWhitelist(value) {
  if (value == null || String(value).trim() === '') {
    return ''
  }
  return String(value)
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ')
}
