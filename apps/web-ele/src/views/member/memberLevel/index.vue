<script setup name="MemberLevel">
  import { nextTick, reactive, ref, toRefs } from 'vue'

  import {
    addMemberLevel,
    delMemberLevel,
    getMemberLevel,
    listMemberLevel,
    updateMemberLevel,
  } from '@/api/member/memberLevel'
  import { parseTime } from '@/utils'
  import {
    Delete,
    Edit as EditIcon,
    EditPen,
    Plus,
    Refresh,
    Search,
  } from '@element-plus/icons-vue'
  import { ElMessage, ElMessageBox } from 'element-plus'

  const memberLevelList = ref([])
  const open = ref(false)
  const loading = ref(true)
  const showSearch = ref(true)
  const ids = ref([])
  const single = ref(true)
  const multiple = ref(true)
  const total = ref(0)
  const title = ref('')

  // 表单引用
  const memberLevelFormRef = ref()
  const queryFormRef = ref()

  const data = reactive({
    form: {},
    queryParams: {
      pageNum: 1,
      pageSize: 10,
      levelName: undefined,
      levelCode: undefined,
      dataStatus: undefined,
    },
    rules: {
      levelName: [
        { required: true, message: '等级名称不能为空', trigger: 'blur' },
      ],
      levelCode: [
        { required: false, message: '等级编码不能为空', trigger: 'blur' },
      ],
      level: [{ required: true, message: '等级权重不能为空', trigger: 'blur' }],
      orderNum: [{ required: true, message: '排序不能为空', trigger: 'blur' }],
    },
  })

  const { queryParams, form, rules } = toRefs(data)

  /** 查询会员等级列表 */
  function getList() {
    loading.value = true
    listMemberLevel(queryParams.value).then((response) => {
      memberLevelList.value = response.rows || response.list || []
      total.value = response.total
      loading.value = false
    })
  }

  /** 分页大小变化 */
  function handleSizeChange(size) {
    queryParams.value.pageSize = size
    queryParams.value.pageNum = 1
    getList()
  }

  /** 当前页变化 */
  function handleCurrentChange(page) {
    queryParams.value.pageNum = page
    getList()
  }

  // 取消按钮
  function cancel() {
    open.value = false
    reset()
  }

  // 表单重置
  function reset() {
    form.value = {
      id: undefined,
      levelName: undefined,
      levelCode: undefined,
      level: undefined,
      orderNum: 0,
      minIntegral: undefined,
      maxIntegral: undefined,
      discount: undefined,
      monthPrice: undefined,
      quarterPrice: undefined,
      yearPrice: undefined,
      halfYearPrice: undefined,
      monthApiQuota: 30,
      quarterApiQuota: 90,
      halfYearApiQuota: 180,
      yearApiQuota: -1,
      monthChatQuota: 50,
      quarterChatQuota: 150,
      halfYearChatQuota: 300,
      yearChatQuota: -1,
      discountDisplay: 1,
      levelDesc: undefined,
      permissions: undefined,
      dataStatus: 1,
      remark: undefined,
    }
    nextTick(() => {
      memberLevelFormRef.value?.resetFields()
    })
  }

  /** 搜索按钮操作 */
  function handleQuery() {
    queryParams.value.pageNum = 1
    getList()
  }

  /** 重置按钮操作 */
  function resetQuery() {
    queryFormRef.value?.resetFields()
    handleQuery()
  }

  // 多选框选中数据
  function handleSelectionChange(selection) {
    ids.value = selection.map((item) => item.id)
    single.value = selection.length != 1
    multiple.value = !selection.length
  }

  /** 新增按钮操作 */
  function handleAdd() {
    reset()
    open.value = true
    title.value = '添加会员等级'
  }

  /** 修改按钮操作 */
  function handleUpdate(row) {
    reset()
    let _id = row.id
    if (row.id == undefined) {
      _id = ids.value[0]
    }
    getMemberLevel(_id).then((response) => {
      form.value = response.data
      open.value = true
      title.value = '修改会员等级'
    })
  }

  /** 提交按钮 */
  function submitForm() {
    memberLevelFormRef.value?.validate((valid) => {
      if (valid) {
        if (form.value.id != undefined) {
          updateMemberLevel(form.value).then((response) => {
            ElMessage.success('修改成功')
            open.value = false
            getList()
          })
        } else {
          addMemberLevel(form.value).then((response) => {
            ElMessage.success('新增成功')
            open.value = false
            getList()
          })
        }
      }
    })
  }

  /** 删除按钮操作 */
  function handleDelete(row) {
    const _ids = row.id || ids.value
    ElMessageBox.confirm(
      '是否确认删除会员等级编号为"' + _ids + '"的数据项？',
      '警告',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
      .then(() => {
        return delMemberLevel(_ids)
      })
      .then(() => {
        getList()
        ElMessage.success('删除成功')
      })
      .catch(() => {})
  }

  getList()
</script>

<template>
  <div class="app-container">
    <el-form
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      v-show="showSearch"
      label-width="100px"
    >
      <el-form-item label="等级名称" prop="levelName">
        <el-input
          v-model="queryParams.levelName"
          placeholder="请输入等级名称"
          clearable
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="等级编码" prop="levelCode">
        <el-input
          v-model="queryParams.levelCode"
          placeholder="请输入等级编码"
          clearable
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="状态" prop="dataStatus">
        <el-select
          v-model="queryParams.dataStatus"
          placeholder="会员等级状态"
          clearable
        >
          <el-option label="正常" value="1" />
          <el-option label="停用" value="0" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="handleQuery">
          搜索
        </el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button type="primary" plain :icon="Plus" @click="handleAdd">
          新增
        </el-button>
      </el-col>
      <el-col :span="1.5">
        <el-button
          type="success"
          plain
          :icon="EditPen"
          :disabled="single"
          @click="handleUpdate"
        >
          修改
        </el-button>
      </el-col>
      <el-col :span="1.5">
        <el-button
          type="danger"
          plain
          :icon="Delete"
          :disabled="multiple"
          @click="handleDelete"
        >
          删除
        </el-button>
      </el-col>
    </el-row>

    <el-table
      v-loading="loading"
      :data="memberLevelList"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column label="等级ID" align="center" prop="id" width="80" />
      <el-table-column
        label="等级权重"
        align="center"
        prop="level"
        width="100"
      />
      <el-table-column
        label="等级名称"
        align="center"
        prop="levelName"
        width="120"
      />
      <el-table-column
        label="等级编码"
        align="center"
        prop="levelCode"
        width="120"
      />
      <el-table-column label="排序" align="center" prop="orderNum" width="80" />
      <el-table-column label="积分区间" align="center" width="150">
        <template #default="scope">
          <span>
            {{ scope.row.minIntegral || 0 }}-{{ scope.row.maxIntegral || '∞' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column
        label="月费价格"
        align="center"
        prop="monthPrice"
        width="120"
      >
        <template #default="scope">
          <span>￥{{ scope.row.monthPrice || 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="季费价格"
        align="center"
        prop="quarterPrice"
        width="120"
      >
        <template #default="scope">
          <span>￥{{ scope.row.quarterPrice || 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="年费价格"
        align="center"
        prop="yearPrice"
        width="120"
      >
        <template #default="scope">
          <span>￥{{ scope.row.yearPrice || 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="折扣显示"
        align="center"
        prop="discountDisplay"
        width="100"
      >
        <template #default="scope">
          <span
            v-if="scope.row.discountDisplay && scope.row.discountDisplay < 1"
          >
            {{ (scope.row.discountDisplay * 10).toFixed(1) }}折
          </span>
          <span v-else>无折扣</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" align="center" prop="dataStatus" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.dataStatus === 1 ? 'success' : 'danger'">
            {{ scope.row.dataStatus === 1 ? '正常' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
      >
        <template #default="scope">
          <span>
            {{ parseTime(scope.row.createTime, '{y}-{m}-{d} {h}:{i}:{s}') }}
          </span>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        align="center"
        class-name="small-padding fixed-width"
        width="180"
        fixed="right"
      >
        <template #default="scope">
          <el-button
            link
            type="primary"
            :icon="EditIcon"
            @click="handleUpdate(scope.row)"
          >
            修改
          </el-button>
          <el-button
            link
            type="danger"
            :icon="Delete"
            @click="handleDelete(scope.row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-show="total > 0"
      :current-page="queryParams.pageNum"
      :page-size="queryParams.pageSize"
      :total="total"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next, jumper"
      @size-change="handleSizeChange"
      @current-change="handleCurrentChange"
    />

    <!-- 添加或修改会员等级对话框 -->
    <el-dialog :title="title" v-model="open" width="900px" append-to-body>
      <el-form
        ref="memberLevelFormRef"
        :model="form"
        :rules="rules"
        label-width="100px"
      >
        <el-row>
          <el-col :span="8">
            <el-form-item label="等级名称" prop="levelName">
              <el-input v-model="form.levelName" placeholder="请输入等级名称" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="等级编码" prop="levelCode">
              <el-input v-model="form.levelCode" placeholder="请输入等级编码" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="等级权重" prop="level">
              <el-input-number
                v-model="form.level"
                :min="1"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="8">
            <el-form-item label="排序" prop="orderNum">
              <el-input-number
                v-model="form.orderNum"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="状态" prop="dataStatus">
              <el-radio-group v-model="form.dataStatus">
                <el-radio :label="1">正常</el-radio>
                <el-radio :label="0">停用</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="等级权益" prop="discount">
              <el-input-number
                v-model="form.discount"
                :precision="2"
                :min="0"
                :max="1"
                :step="0.01"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="8">
            <el-form-item label="最小积分" prop="minIntegral">
              <el-input-number
                v-model="form.minIntegral"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="最大积分" prop="maxIntegral">
              <el-input-number
                v-model="form.maxIntegral"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="8">
            <el-form-item label="月费价格" prop="monthPrice">
              <el-input-number
                v-model="form.monthPrice"
                :precision="2"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="季费价格" prop="quarterPrice">
              <el-input-number
                v-model="form.quarterPrice"
                :precision="2"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="半年费价格" prop="halfYearPrice">
              <el-input-number
                v-model="form.halfYearPrice"
                :precision="2"
                :step="0.01"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="年费价格" prop="yearPrice">
              <el-input-number
                v-model="form.yearPrice"
                :precision="2"
                :min="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="8">
            <el-form-item label="月费次数" prop="monthApiQuota">
              <el-input-number
                v-model="form.monthApiQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="季费次数" prop="quarterApiQuota">
              <el-input-number
                v-model="form.quarterApiQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="半年费次数" prop="halfYearApiQuota">
              <el-input-number
                v-model="form.halfYearApiQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="年费次数" prop="yearApiQuota">
              <el-input-number
                v-model="form.yearApiQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="8">
            <el-form-item label="月费对话额度" prop="monthChatQuota">
              <el-input-number
                v-model="form.monthChatQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="季费对话额度" prop="quarterChatQuota">
              <el-input-number
                v-model="form.quarterChatQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="半年费对话额度" prop="halfYearChatQuota">
              <el-input-number
                v-model="form.halfYearChatQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="年费对话额度" prop="yearChatQuota">
              <el-input-number
                v-model="form.yearChatQuota"
                :min="-1"
                placeholder="-1表示无限"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="8">
            <el-form-item label="折扣显示" prop="discountDisplay">
              <el-input-number
                v-model="form.discountDisplay"
                :precision="2"
                :min="0"
                :max="1"
                :step="0.1"
                placeholder="1为不显示,0.9为9折"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="等级描述" prop="levelDesc">
          <el-input
            v-model="form.levelDesc"
            type="textarea"
            placeholder="请输入等级描述"
          />
        </el-form-item>
        <el-form-item label="等级权限" prop="permissions">
          <el-input
            v-model="form.permissions"
            type="textarea"
            placeholder="请输入权限配置（JSON格式）"
          />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="form.remark"
            type="textarea"
            placeholder="请输入内容"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancel">取 消</el-button>
          <el-button type="primary" @click="submitForm">确 定</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
