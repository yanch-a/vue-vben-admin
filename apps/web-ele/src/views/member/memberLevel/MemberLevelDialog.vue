<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { doEdit, getById } from '@/api/member/memberLevelApi'
  import { activeValue, getDictData } from '@/utils/convert'
  import { InfoFilled } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'MemberLevelDialog',
    components: {
      InfoFilled,
    },
    emits: ['fetchData'],
    setup(props, { emit }) {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        elForm: null,
        dataStatusOptions: getDictData('dataStatus').data,
        form: {
          minIntegral: 0,
          maxIntegral: 100,
          discount: 0,
          monthPrice: 0,
          quarterPrice: 0,
          halfYearPrice: 0,
          yearPrice: 0,
          orderNum: 10,
          dataStatus: 1,
        },
        rules: {
          levelName: [
            { required: true, trigger: 'blur', message: '请输入等级名称' },
          ],
          level: [
            { required: true, trigger: 'change', message: '请选择等级权重' },
          ],
          minIntegral: [
            { required: true, trigger: 'blur', message: '请输入最小所需积分' },
          ],
          maxIntegral: [
            { required: true, trigger: 'blur', message: '请输入最大所需积分' },
          ],
          discount: [
            { required: true, trigger: 'blur', message: '请输入等级权益' },
          ],
          orderNum: [
            { required: true, trigger: 'blur', message: '请输入排序' },
          ],
          dataStatus: [
            { required: true, trigger: 'change', message: '请选择状态' },
          ],
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
          if (!data) {
            $baseMessage('未查到相关数据', 'error', 'vab-hey-message-error')
            return
          }
          state.form = data
        }
        state.dialogFormVisible = true
      }
      const close = () => {
        state.elForm.resetFields()
        state.form = {
          minIntegral: 0,
          maxIntegral: 100,
          discount: 0,
          monthPrice: 0,
          quarterPrice: 0,
          halfYearPrice: 0,
          yearPrice: 0,
          orderNum: 10,
          dataStatus: 1,
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
    width="560px"
    @close="close"
  >
    <el-form
      ref="elForm"
      class="member-level-form"
      label-width="140px"
      :model="form"
      :rules="rules"
      size="large"
    >
      <el-form-item label="等级名称" prop="levelName">
        <el-input
          v-model="form.levelName"
          maxlength="50"
          placeholder="请输入等级名称"
        />
      </el-form-item>
      <el-form-item label="等级权重" prop="level">
        <template #label>
          <el-tooltip content="数值越大权重越高" placement="top">
            <el-icon style="height: 100%"><InfoFilled /></el-icon>
          </el-tooltip>
          等级权重
        </template>
        <el-select
          v-model="form.level"
          placeholder="请选择权重"
          style="width: 100%"
        >
          <el-option
            v-for="num in 20"
            :key="num"
            :label="String(num)"
            :value="num"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="所需积分" prop="minIntegral">
        <div class="integral-range">
          <el-input-number
            v-model="form.minIntegral"
            :controls="false"
            :max="999999999"
            :min="0"
            style="width: 100%"
          />
          <span class="integral-sep">-</span>
          <el-input-number
            v-model="form.maxIntegral"
            :controls="false"
            :max="999999999"
            :min="0"
            style="width: 100%"
          />
        </div>
      </el-form-item>
      <el-form-item label="等级权益" prop="discount">
        <template #label>
          <el-tooltip
            content="折扣率范围0.0-9.9，例如: 9.8代表98折，0代表不折扣"
            placement="top"
          >
            <el-icon style="height: 100%"><InfoFilled /></el-icon>
          </el-tooltip>
          等级权益
        </template>
        <el-input-number
          v-model="form.discount"
          :precision="2"
          :step="0.1"
          :max="10"
          :min="0"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="月费价格" prop="monthPrice">
        <el-input-number
          v-model="form.monthPrice"
          :precision="2"
          :step="0.01"
          :max="999999"
          :min="0"
          placeholder="请输入月费价格"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="季费价格" prop="quarterPrice">
        <el-input-number
          v-model="form.quarterPrice"
          :precision="2"
          :step="0.01"
          :max="999999"
          :min="0"
          placeholder="请输入季费价格"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="半年费价格" prop="halfYearPrice">
        <el-input-number
          v-model="form.halfYearPrice"
          :precision="2"
          :step="0.01"
          :max="999999"
          :min="0"
          placeholder="请输入半年费价格"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="年费价格" prop="yearPrice">
        <el-input-number
          v-model="form.yearPrice"
          :precision="2"
          :step="0.01"
          :max="999999"
          :min="0"
          placeholder="请输入年费价格"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="排序" prop="orderNum">
        <el-input-number
          v-model="form.orderNum"
          :step="1"
          :max="999"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="form.remark"
          type="textarea"
          :maxlength="500"
          placeholder="请输入备注"
          :autosize="{ minRows: 4, maxRows: 4 }"
        />
      </el-form-item>
      <el-form-item label="状态" prop="dataStatus">
        <el-radio-group v-model="form.dataStatus">
          <el-radio
            v-for="item in dataStatusOptions"
            :key="item.code"
            border
            :value="item.code"
          >
            {{ item.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取 消</el-button>
      <el-button type="primary" @click="save">确 定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.member-level-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
.member-level-form :deep(.el-input),
.member-level-form :deep(.el-select),
.member-level-form :deep(.el-input-number) {
  width: 100%;
}
.integral-range {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
}
.integral-sep {
  flex: none;
  color: var(--el-text-color-secondary);
}
</style>
