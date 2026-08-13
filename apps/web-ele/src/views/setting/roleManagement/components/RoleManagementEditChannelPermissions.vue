<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { getAllTree } from '@/api/cms/cmsChannelApi'
  import { getChannelIds, updateRoleChannelPerm } from '@/api/roleManagement'

  export default defineComponent({
    name: 'RoleManagementEditPermissions',
    emits: ['fetchData'],
    setup() {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        formRef2: null,
        treeRef: null,
        defaultProps: {
          children: 'children',
          label: 'label',
        },
        form: {
          roleId: 0,
        },
        rules: {
          role: [{ required: true, trigger: 'blur', message: '请输入角色码' }],
        },
        title: '',
        dialogFormVisible: false,
        list: [],
        noCheck: false,
        checkedKeys: [],
        fetchDataFlag: true,
      })

      const showChannelEditPermissions = (row) => {
        if (row) {
          state.form.roleId = row.id
          state.title = '分配权限-【'+row.roleName+'】'
          state.dialogFormVisible = true
          fetchData()
        }
      }
      const close = () => {
        state.fetchDataFlag = true
        state.formRef2.resetFields()
        state.list = []
        state.form = {
        }
        state.checkedKeys = []
        state.dialogFormVisible = false
        state.btnRoles = []
      }
      const fetchData = async () => {
        state.fetchDataFlag = true
        const {
          data: list ,
        } = await getAllTree()
        // 查询角色拥有的菜单权限
        const { data } = await getChannelIds({ roleId: state.form.roleId, roleType: 'CHANNEL' })
        // state.checkedKeys = data
        setCheckKeys(list, data)
        state.list = list
        state.fetchDataFlag = false
      }
      const setCheckKeys = (list, data) => {
        list.forEach(item => {
          const children = item.children
          if(!children || children.length == 0) {
            if(data.indexOf(item.id) >= 0) {
              state.checkedKeys.push(item.id)
            }
          }else {
            setCheckKeys(children, data)
          }
        })
      }
      // 菜单点击时改变右侧菜单按钮列表
      const nodeClick = async (node, nodeObj) => {
        
      }
      // 传递给 data 属性的数组中该节点所对应的对象、节点本身是否被选中、节点的子树中是否有被选中的节点
      const checkChange = async (node, nodeSelect, childSelect) => {
        if(!state.fetchDataFlag) {
          // 目录节点需要使用第三个参数判断是否选中
          // let flag = nodeSelect
          let flag = nodeSelect || childSelect
          // 只有选中菜单类型时才执行
          if(flag){
            // 节点选中，增加角色菜单和操作按钮权限
            const { msg } = await updateRoleChannelPerm({roleId: state.form.roleId, moduleId: node.id, dealType: 1, roleType: 'CHANNEL'})
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            // 按钮全选中，变为可操作状态
            state.noCheck = false
          }else {
            // 取消节点选中，后台删除相应权限
            // 节点取消选中，删除角色菜单和操作按钮权限
            const { msg } = await updateRoleChannelPerm({roleId: state.form.roleId, moduleId: node.id, dealType: 0, roleType: 'CHANNEL'})
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            state.noCheck = true
          }
        }
      }

      onMounted(() => {
        
      })
      return {
        ...toRefs(state),
        showChannelEditPermissions,
        close,
        fetchData,
        nodeClick,
        checkChange,
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
    <el-form ref="formRef2" label-width="80px" :model="form" :rules="rules">
      <div class="vab-tree-border" style="height:90%;">
        <div style="float:left;width: 30%;">
          <el-tree
            ref="treeRef"
            :data="list"
            :default-checked-keys="checkedKeys"
            :default-expanded-keys="checkedKeys"
            node-key="id"
            :props="defaultProps"
            show-checkbox
            @check-change="checkChange"
            @node-click="nodeClick"
          />
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
