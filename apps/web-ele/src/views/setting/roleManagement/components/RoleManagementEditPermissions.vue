<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { getTree } from '@/api/menuManagement'
  import { getModuleIds, getModuleOperations, updateRoleOpera, updateRolePerm } from '@/api/roleManagement'

  export default defineComponent({
    name: 'RoleManagementEditPermissions',
    emits: ['fetchData'],
    setup() {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        formRef1: null,
        treeRef: null,
        defaultProps: {
          children: 'children',
          label: 'menuName',
        },
        form: {
          roleId: 0,
          btnRolesCheckedList: [],
        },
        rules: {
          role: [{ required: true, trigger: 'blur', message: '请输入角色码' }],
        },
        title: '',
        dialogFormVisible: false,
        list: [],
        btnRoles: [],
        noCheck: false,
        checkedKeys: [],
        fetchDataFlag: true,
      })

      const showEditPermissions = (row) => {
        if (row) {
          state.form.roleId = row.id
          state.title = '分配权限-【'+row.roleName+'】'
          state.dialogFormVisible = true
          fetchData()
        }
      }
      const close = () => {
        state.fetchDataFlag = true
        state.formRef1.resetFields()
        state.list = []
        state.form = {
          btnRolesCheckedList: [],
        }
        state.checkedKeys = []
        state.dialogFormVisible = false
        state.btnRoles = []
      }
      const fetchData = async () => {
        state.fetchDataFlag = true
        const {
          data: { list },
        } = await getTree()
        // 查询角色拥有的菜单权限
        const { data } = await getModuleIds({ roleId: state.form.roleId })
        // state.checkedKeys = data
        setCheckKeys(list, data)
        state.list = list
        state.fetchDataFlag = false
      }
      const setCheckKeys = (list, data) => {
        list.forEach(item => {
          const children = item.children
          if(!children || children.length == 0) {
            if(data.indexOf(item.menuId) > 0) {
              state.checkedKeys.push(item.menuId)
            }
          }else {
            setCheckKeys(children, data)
          }
        })
      }
      // 菜单点击时改变右侧菜单按钮列表
      const nodeClick = async (node, nodeObj) => {
        if(node.sysSelect==1) {
          const { data: { list, operationIds } } = await getModuleOperations({moduleCode: node.name, roleId: state.form.roleId})
          state.btnRoles = list
          state.form.btnRolesCheckedList = operationIds
        }else {
          state.btnRoles = []
          state.form.btnRolesCheckedList = []
        }
        if(nodeObj.checked){
          state.noCheck = false
        }else {
          state.noCheck = true
        }
      }
      // 传递给 data 属性的数组中该节点所对应的对象、节点本身是否被选中、节点的子树中是否有被选中的节点
      const checkChange = async (node, nodeSelect, childSelect) => {
        if(!state.fetchDataFlag) {
          // 目录节点需要使用第三个参数判断是否选中
          let flag = nodeSelect
          if(node.menuType == 'M') {
            flag = nodeSelect || childSelect
          }
          // 选中节点，显示节点操作按钮
          if(node.menuType == 'C' || node.menuType == 'M') {
            // 只有选中菜单类型时才执行
            if(flag){
              // 节点选中，增加角色菜单和操作按钮权限
              const { msg } = await updateRolePerm({roleId: state.form.roleId, moduleId: node.menuId, dealType: 1})
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              // 按钮全选中，变为可操作状态
              state.noCheck = false
            }else {
              // 取消节点选中，后台删除相应权限
              // 节点取消选中，删除角色菜单和操作按钮权限
              const { msg } = await updateRolePerm({roleId: state.form.roleId, moduleId: node.menuId, dealType: 0})
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              state.noCheck = true
            }
            // 从库中查出当前勾选的数据
            const { data: { list, operationIds } } = await getModuleOperations({moduleCode: node.name, roleId: state.form.roleId})
            state.btnRoles = list
            state.form.btnRolesCheckedList = operationIds
          }
        }
      }
      // operation 复选框改变时触发
      const operaCheckChange = async (val, evn) => {
        const operaId = evn.currentTarget.value
        if(val) {
          // 新增权限
          const { msg } = await updateRoleOpera({roleId: state.form.roleId, operaId, dealType: 1})
          $baseMessage(msg, 'success', 'vab-hey-message-success')
        }else {
          // 删除权限
          const { msg } = await updateRoleOpera({roleId: state.form.roleId, operaId, dealType: 0})
          $baseMessage(msg, 'success', 'vab-hey-message-success')
        }
      }

      return {
        ...toRefs(state),
        showEditPermissions,
        close,
        fetchData,
        nodeClick,
        checkChange,
        operaCheckChange,
      }
    },
  })
</script>

<template>
  <el-dialog
    v-model="dialogFormVisible"
    :title="title"
    width="80%"
    @close="close"
  >
    <el-form ref="formRef1" label-width="80px" :model="form" :rules="rules">
      <div class="vab-tree-border" style="height:90%;">
        <div style="float:left;width: 30%;">
          <el-tree
            ref="treeRef"
            :data="list"
            :default-checked-keys="checkedKeys"
            :default-expanded-keys="checkedKeys"
            node-key="menuId"
            :props="defaultProps"
            show-checkbox
            @check-change="checkChange"
            @node-click="nodeClick"
          />
        </div>
        <div style="float: left;width: 68%;">
          <el-checkbox-group v-model="form.btnRolesCheckedList" :disabled="noCheck">
            <el-checkbox
              v-for="item in btnRoles"
              :key="item.id"
              border
              :label="item.id"
              @change="operaCheckChange"
            >
              {{ item.operationName }}
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </div>
    </el-form>
    <template #footer>
      <el-button type="primary" @click="close">关 闭</el-button>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
  .vab-tree-border {
    width: 100%;
    height: 250px;
    padding: 20px;
    overflow-y: auto;
    border: 1px solid #dcdfe6;
    border-radius: 2.5px;
  }
</style>
