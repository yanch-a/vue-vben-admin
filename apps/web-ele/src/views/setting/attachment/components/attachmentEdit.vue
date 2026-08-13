<script>
  import {
    defineComponent,
    reactive,
    toRefs,
  } from 'vue'

  import LemonUpload from '@/components/lemon-upload/index.vue'

  export default defineComponent({
    name: 'AttachmentEdit',
    components: {
      LemonUpload,
    },
    emits: ['fetchData'],
    setup(props, { emit }) {
      const state = reactive({
        formRef: null,
        form: {
          moduleCode: '',
          attachmentIds: '',
        },
        rules: {
          'moduleCode': [{ required: true, trigger: 'blur', message: '请输入业务分类' }],
        },
        title: '',
        dialogFormVisible: false,
        options: [],
      })

      const showEdit = async (row) => {
        state.title = '上传文件'
        state.dialogFormVisible = true
      }
      const close = () => {
        if (state.formRef) {
          state.formRef.resetFields()
        }
        state.form = {
          moduleCode: '',
          attachmentIds: '',
        }
        state.dialogFormVisible = false
        emit('fetchData')
      }

      const handleContentImg = (val) => {
        const list = Array.isArray(val) ? val : []
        const fileIds = list.map((item) => item.id).filter(Boolean)
        state.form.attachmentIds = fileIds.join(',')
        close()
      }
      return {
        ...toRefs(state),
        showEdit,
        close,
        handleContentImg,
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
  <el-form ref="formRef" label-width="100px" :model="form" :rules="rules" size="default">
      <el-row>
        <el-col :span="8">
          <el-form-item label="业务分类" prop="moduleCode">
            <el-input v-model="form.moduleCode" maxlength="30" placeholder="业务分类" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="文件">
            <LemonUpload :attach-code="form.moduleCode || 'resource'" :ids="form.attachmentIds" @handle-file="handleContentImg" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
  </el-dialog>
</template>
