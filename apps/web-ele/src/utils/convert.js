/**
 * @auth: yanch
 * #date: 2020年8月11日
 */
import dictMap from './dict/allDict'

// 字典数据
let dict = null

function getDict(dictFile) {
  if (!dict) {
    if (!dictFile) {
      dictFile = 'common'
    }
    dict = dictMap[dictFile]
  }
  // return dictMap[dictFile]
}

/**
 * 根据字典类型获取字典数据
 * @param {string} dictType 字典分类代码
 * @param {string} dictFile 指定字典文件名称，为空时默认取common.js文件中的字典项
 * @returns 字典项
 */
export function getDictData(dictType, dictFile) {
  getDict(dictFile)
  if (dictType) {
    dictType = getKey(dictType)

    return dict[dictType]
  }
  return {}
}

/**
 * 根据字典类型和编码获取字典名称
 * @param {string} dictType 字典分类代码
 * @param {string} dictCode 要转换的字段编码
 * @param {string} dictFile 指定字典文件名称，为空时默认取common.js文件中的字典项
 * @returns
 */
export function convert(dictType, dictCode, dictFile) {
  if (dictType && dictCode) {
    getDict(dictFile)
    dictType = getKey(dictType)
    const dictData = dict[dictType]
    if (dictData) {
      const typeofd = 'number'
      if (!typeof dictCode == typeofd) {
        const arr =
          dictCode.indexOf(';') != -1
            ? dictCode.split(';')
            : dictCode.split(',')
        if (arr.length > 1) {
          let mtVal = ''
          // 分号隔开的多个字典属性
          for (const ldc in arr) {
            const tep = c2n(dictData, arr[ldc])
            if (tep) {
              mtVal += `;${tep}`
            } else {
              mtVal += `;${arr[ldc]}`
            }
          }
          return mtVal.substring(1)
        } else {
          const val = c2n(dictData, dictCode)
          if (val) {
            return val
          } else {
            return dictCode
          }
        }
      } else {
        const val = c2n(dictData, dictCode)
        if (val) {
          return val
        } else {
          return dictCode
        }
      }
    }
    return dictCode
  }
}

/**
 * 将字典code转换为name
 * @param {Object} dictData 字典配置对象
 * @param {string} dictCode 要转换的编码
 * @returns
 */
function c2n(dictData, dictCode) {
  const dt = dictData.data
  if (dt instanceof Array) {
    // 字典为数组类型
    for (let i = 0; i < dt.length; i++) {
      const item = dt[i]
      if (item.code == dictCode) {
        return item.label
      }
    }
  } else {
    // 字典为map结构
    return dt[dictCode]
  }
}

/**
 * list转换,list中所有对象字典code转换为name
 * @param {*} obj 要转换的对象
 * @param {string} dictFile 指定字典文件名称，为空时默认取common.js文件中的字典项
 * @param {Array} fieldList 指定要转换的字典，为空时转换所有字段
 * @returns
 */
export function dictConvertObj(obj, dictFile, fieldList) {
  if (obj) {
    if (obj instanceof Array) {
      obj.forEach((item) => {
        convertObj(item, dictFile, fieldList)
      })
    } else {
      // 遍历所有属性进行转换
      convertObj(obj, dictFile, fieldList)
    }
  } else {
    return new Object()
  }
  return obj
}

/**
 * 单个对象转换,对象中字典code转换为name
 * @param {*} item 要转换的对象
 * @param {string} dictFile 指定字典文件名称，为空时默认取common.js文件中的字典项
 * @param {Array} fieldList 指定要转换的字典，为空时转换所有字段
 */
function convertObj(item, dictFile, fieldList) {
  // 指定要转换的字段
  // if(fieldList && fieldList.length>0){
  //   for (let i = 0; i < fieldList.length; i++) {}
  // }
  // 遍历所有属性进行转换
  for (const key in item) {
    const v = item[key]
    // 判断是否为树结构
    if (v instanceof Array) {
      dictConvertObj(v, dictFile)
    } else if (v instanceof Object) {
      // 子对象
      convertObj(v, dictFile)
    } else {
      // 指定要转换的字段
      if (fieldList && fieldList.length > 0) {
        if (fieldList.indexOf(key) >= 0) {
          item[key] = convert(key, v, dictFile)
        }
      } else {
        item[key] = convert(key, v, dictFile)
      }
    }
  }
}

export function unescapeObj(obj) {
  if (obj) {
    // 遍历所有属性进行转换
    for (const key in obj) {
      // 转换被转义字段
      obj[key] = unescape(obj[key])
    }
  } else {
    return new Object()
  }
  return obj
}

/**
 * 根据字典分类代码获取字典分类数据
 * @param {string} dictType 字典分类编码
 * @returns 字典编码
 */
function getKey(dictType) {
  const typeCode = dict.keys[dictType]
  if (typeCode) {
    return typeCode
  }
  return dictType
}

// 根据字典类型,获取分组效果的字典数据
// 目前仅支持，一级字典码为纯字母，二级字典码为 字母+数字的形式
export function getGroupDictData(dictType, dictFile) {
  if (dictType) {
    getDict(dictFile)
    dictType = getKey(dictType)
    const dictData = dict[dictType]
    if (dictData) {
      const groupDictData = {}
      groupDictData.note = dictData.note
      const dictList = dictData.data
      if (dictList) {
        groupDictData.data = []
        const groupObj = {}
        const itemObj = {}
        const entries = Object.entries(dictList)
        for (let i = 0; i < entries.length; i++) {
          const [key, value] = entries[i]
          if (!containsNumber(key)) {
            if (!Object.keys(groupObj).length == 0) {
              groupDictData.data.push(groupObj)
            }
            groupObj.value = key
            groupObj.label = value
            groupObj.options = []
          } else {
            itemObj.value = key
            itemObj.label = value
            groupObj.options.push(itemObj)
          }
          if (i == entries.length - 1) {
            groupDictData.data.push(groupObj)
          }
        }
        return groupDictData
      }
    }
  }
  return {}
}

// 判断字符串是否包含数字
function containsNumber(str) {
  const reg = /\d/
  return reg.test(str)
}

/** el-switch 滑块的true 和 false 匹配值，字符串或数值类型要和value一致 */
export const activeValue = {
  active: 1,
  inActive: 0,
}
