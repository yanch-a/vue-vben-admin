<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { getTree } from '@/api/departmentManagement'
  import { doEdit, getById } from '@/api/userManagement'
  // import { getOptionselect } from '@/api/roleManagement'
  import { activeValue, getDictData } from '@/utils/convert'

  export default defineComponent({
    name: 'UserManagementEdit',
    emits: ['fetchData'],
    setup(props, { emit }) {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        formRef: null,
        treeData: [],
        defaultProps: {
          children: 'children',
          label: 'label',
        },
        form: {
          roleIds: [],
          status: 1,
          userType: 'pc',
        },
        rules: {
          userName: [{ required: true, trigger: 'blur', message: '请输入登录名' }],
          nickName: [{ required: true, trigger: 'blur', message: '请输入昵称' }],
          phonenumber: [{ required: true, trigger: 'blur', message: '请输入手机号' }],
          email: [{ required: true, trigger: 'blur', message: '请输入邮箱' }],
          roleIds: [{ required: true, trigger: 'change', message: '请选择角色' }],
          userType: [{ required: true, trigger: 'change', message: '请选择用户类型' }],
          deptId: [{ required: true, trigger: 'change', message: '请选择部门' }],
          status: [{ required: true, trigger: 'change', message: '请选择用户状态' }],
        },
        title: '',
        dialogFormVisible: false,
        userTypes: getDictData("userType").data,
        options: [],
        isEdit: false,
      })

      const showEdit = async (row) => {
        fetchData()
        if (!row) {
          state.title = '添加用户'
          const { data: { roles } } = await getById({userId: 0})
          state.options = roles
          state.rules.password = [{ required: true, trigger: 'blur', message: '请输入密码' }]
        } else {
          state.isEdit = true
          state.title = '修改用户-【'+row.userName+'】'
          const { data: { roles, user} } = await getById(row)
          if( !user ){
            $baseMessage('未查到相关数据', 'error', 'vab-hey-message-error')
            return;
          }
          state.form = user
          state.options = roles
        }
        state.dialogFormVisible = true
      }
      const close = () => {
        state.formRef.resetFields()
        state.form = {
          roleIds: [],
          status: 1,
          userType: 'pc',
        }
        state.options = []
        state.dialogFormVisible = false
        state.isEdit = false
      }
      const save = () => {
        state.formRef.validate(async (valid) => {
          if (valid) {
            const { msg } = await doEdit(state.form)
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            emit('fetchData')
            close()
          }
        })
      }
      const fetchData = async () => {
        if(state.treeData.length==0){
          // 部门树
          const { data } = await getTree(state.queryForm)
          state.treeData = data
          // 角色下拉
          // const { roles } = await getOptionselect(state.queryForm)
          // state.options = roles
        }
      }
      return {
        ...toRefs(state),
        showEdit,
        close,
        save,
        activeValue,
      }
    },
  })
</script>

<template>
  <el-dialog
    v-model="dialogFormVisible"
    :title="title"
    width="60%"
    @close="close"
  >
    <el-form ref="formRef" label-width="80px" :model="form" :rules="rules">
      <el-row>
        <el-col :span="12">
          <el-form-item label="登录名" prop="userName">
            <el-input v-model.trim="form.userName" :disabled="isEdit" />
          </el-form-item>
        </el-col>
        <el-col v-if="!isEdit" :span="12">
          <el-form-item label="密码" prop="password">
            <el-input v-model.trim="form.password" type="password" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="12">
          <el-form-item label="部门" prop="deptId">
            <el-tree-select
              v-model="form.deptId"
              check-strictly
              :data="treeData"
              highlight-current
              node-key="id"
              :props="defaultProps"
              :render-after-expand="false"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="角色" prop="roleIds">
            <el-select
              v-model="form.roleIds"
              filterable
              multiple
              placeholder="请选择角色"
              style="width: 240px"
            >
              <el-option
                v-for="item in options"
                :key="item.roleId"
                :label="item.roleName"
                :value="item.roleId"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="12">
          <el-form-item label="昵称" prop="nickName">
            <el-input v-model.trim="form.nickName" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="用户类型" prop="userType">
            <el-select v-model="form.userType">
              <el-option
                v-for="(key, value) in userTypes"
                :key="value"
                :label="key"
                :value="value"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="12">
          <el-form-item label="手机号" prop="phonenumber">
            <el-input v-model.trim="form.phonenumber" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="邮箱" prop="email">
            <el-input v-model.trim="form.email" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="8">
          <el-form-item label="用户状态" prop="status">
            <el-switch v-model="form.status" :active-value="activeValue.active" :inactive-value="activeValue.inActive" />
          </el-form-item>
        </el-col>
      </el-row>
</el-form>
    <template #footer>
      <el-button @click="close">取 消</el-button>
      <el-button type="primary" @click="save">确 定</el-button>
    </template>
  </el-dialog>
</template>
