// 公共的字典数据
const dict = {
  // 字典中会有一个类型对应多个名字的字典，所以加个keys做映射
  keys: {
    // key为字段名称，value为本字典数据中的key
    // visible: "tf",
    isFrame: "tf",
    isCache: "tf",
    configType: "tf",

  },
  menuType: {
    note: '菜单类型',
    data: {
      'M': '目录',
      'C': '菜单',
      'F': '按钮',
    }
  },
  tf: {
    note: '是否',
    data: {
      '1': '是',
      '0': '否'
    }
  },
  status: {
    note: '状态',
    data: {
      '1': '正常',
      '0': '禁用'
    }
  },
  dataScope: {
    note: '数据权限',
    data: {
      '1': '所有数据权限',
      '2': '自定义数据权限',
      '5': '仅本人数据权限',
    }
  },
  userType: {
    note: '用户类型',
    data: {
      'pc': 'pc端',
      'mb': '移动端'
    }
  },
  sex: {
    note: '性别',
    data: [{
      code: 1,
      label: '男'
    }, {
      code: 2,
      label: '女'
    }]
  },
  userStatus: {
    note: '用戶状态',
    data: {
      '1': '开启',
      '2': '关闭'
    }
  },
  dataStatus: {
    note: '数据状态',
    data: [{
      code: 1,
      label: '启用'
    }, {
      code: 0,
      label: '禁用'
    }]
  }
}

export default dict