<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { doEdit, getById, getTree } from '@/api/departmentManagement'
  import { activeValue } from '@/utils/convert'

  export default defineComponent({
    name: 'DepartmentManagementEdit',
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
          parentName: '',
          parentId: '',
          status: '1',
        },
        rules: {
          parentId: [
            { required: true, trigger: 'blur', message: '请选择上级部门' },
          ],
          deptName: [{ required: true, trigger: 'blur', message: '请输入部门名称' }],
          deptCode: [{ required: true, trigger: 'blur', message: '请输入部门编码' }],
          order: [{ required: true, trigger: 'blur', message: '请输入排序' }],
        },
        title: '',
        dialogFormVisible: false,
      })

      const fetchData = async () => {
        const { data } = await getTree(state.queryForm)
        data.unshift({id: "0", label: "无", parentId: "0", weight: "0"})
        state.treeData = data
      }
      
      const showEdit = async (row) => {
        if (!row) {
          state.title = '新增部门'
        } else {
          state.title = '编辑部门-【' + row.label + '】'
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
          parentName: '',
          parentId: '',
          status: '1',
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

      fetchData()

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
          <el-form-item label="上级部门" prop="parentId">
            <el-tree-select
              v-model="form.parentId"
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
          <el-form-item label="部门名称" prop="deptName">
            <el-input v-model="form.deptName" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row>
        <el-col :span="12">
          <el-form-item label="部门编码" prop="deptCode">
            <el-input v-model="form.deptCode" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="负责人" prop="leader">
            <el-input v-model="form.leader" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row>
        <el-col :span="12">
          <el-form-item label="联系电话" prop="phone">
            <el-input v-model="form.phone" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="form.email" />
          </el-form-item>
        </el-col>
      </el-row>
      
      <el-row>
        <el-col :span="12">
          <el-form-item label="排序" prop="orderNum">
            <el-input-number v-model="form.orderNum" :max="1000" :min="0" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="是否可用">
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
