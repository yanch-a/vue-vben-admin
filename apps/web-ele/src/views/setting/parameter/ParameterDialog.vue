<script>
  import {
    defineComponent,
    inject,
    reactive,
    toRefs,
  } from 'vue'

  import { doEdit, getById } from '@/api/system/parameterApi'
  import { activeValue } from '@/utils/convert'

  export default defineComponent({
    name: 'ParameterDialog',
    components: {
    },
    emits: ['fetchData'],
    setup(props, { emit }) {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        elForm: null,
        form: {
          orderNum: 10,
        },
        rules: {
          title: [{ required: true, trigger: 'blur', message: '请输入单行文本标题'}],
          code: [{ required: true, trigger: 'blur', message: '请输入编码'}],
          value1: [{ required: true, trigger: 'blur', message: '请输入值1'}],
          value2: [{ required: true, trigger: 'blur', message: '请输入值2'}],
        },
        title: '',
        dialogFormVisible: false,
      })

      const showEdit = async (row) => {
        if (!row) {
          state.title = '新增'
        } else {
          state.title = '编辑-【' + row.id + '】'
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
        state.elForm.resetFields()
        state.form = {
          orderNum: 10,
        }
        state.dialogFormVisible = false
      }
      const save = () => {
        state.elForm.validate(async (valid) => {
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
    width="70%"
    @close="close"
  >
    <el-form ref="elForm" label-width="160px" :model="form" :rules="rules" size="large">
      <el-row>
        <el-col :span="12">
          <el-form-item label="标题" prop="title">
            <el-input v-model="form.title" maxlength="50" placeholder="请输入单行文本标题" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="编码" prop="code">
            <el-input v-model="form.code" maxlength="30" placeholder="请输入编码" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="值1" prop="value1">
            <el-input v-model="form.value1" maxlength="200" placeholder="请输入值1" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="值2" prop="value2">
            <el-input v-model="form.value2" maxlength="200" placeholder="请输入值2" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="多行文本" prop="remark">
            <el-input
v-model="form.remark" type="textarea" :maxlength="500" placeholder="请输入描述"
                      :autosize="{minRows: 4, maxRows: 4}"
/>
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
