<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { doEdit, getById } from '@/api/roleManagement'
  import { activeValue, getDictData } from '@/utils/convert'

  export default defineComponent({
    name: 'RoleManagementEdit',
    emits: ['fetchData'],
    setup(props, { emit }) {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        formRef: null,
        treeRef: null,
        dataScope: getDictData("dataScope").data,
        form: {
          status: 1,
          roleSort: 10,
        },
        rules: {
          roleKey: [{ required: true, trigger: 'blur', message: '请输入角色码' }],
          roleName: [{ required: true, trigger: 'blur', message: '请输入角色名' }],
          dataScope: [{ required: true, trigger: 'change', message: '请选择数据权限' }],
          roleSort: [{ required: true, trigger: 'blur', message: '请输入排序号' }],
          status: [{ required: true, trigger: 'blur', message: '请选择角色状态' }],
        },
        title: '',
        dialogFormVisible: false,
        list: [],
      })

      const showEdit = async (row) => {
        if (!row) {
          state.title = '添加-角色'
        } else {
          state.title = '编辑角色-【' + row.roleName + '】'
          const { data } = await getById(row)
          if( !data ){
            $baseMessage('未查到相关数据', 'error', 'vab-hey-message-error')
            return;
          }
          state.form = data
        }
        state.dialogFormVisible = true
      }
      const close = () => {
        state.formRef.resetFields()
        state.form = {
          status: 1,
          roleSort: 10,
        }
        state.dialogFormVisible = false
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
    width="50%"
    @close="close"
  >
    <el-form ref="formRef" label-width="80px" :model="form" :rules="rules">
      <el-row>
        <el-col :span="12">
          <el-form-item label="角色码" prop="roleKey">
            <el-input v-model="form.roleKey" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="角色名称" prop="roleName">
            <el-input v-model="form.roleName" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="8">
          <el-form-item label="数据权限" prop="dataScope">
            <el-select v-model="form.dataScope" placeholder="数据权限">
              <el-option
                v-for="(key, value) in dataScope"
                :key="value"
                :label="key"
                :value="value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="排序" prop="roleSort">
            <el-input-number v-model="form.roleSort" :max="1000" :min="0" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="角色状态" prop="status">
            <el-switch v-model="form.status" :active-value="activeValue.active" :inactive-value="activeValue.inActive" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="24">
          <el-form-item label="备注" prop="remark">
            <el-input v-model="form.remark" />
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
