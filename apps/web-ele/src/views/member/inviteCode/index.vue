<script setup name="InviteCode">
import { nextTick, reactive, ref, toRefs } from 'vue'

import { addInviteCode, batchGenerateInviteCode, delInviteCode, getInviteCode, listInviteCode, updateInviteCode } from "@/api/member/inviteCode"
import MemberUserSelect from '@/components/MemberUserSelect/index.vue'
import { parseTime } from '@/utils'
import {
  Delete,
  Download,
  Edit as EditIcon,
  EditPen,
  Plus,
  Refresh,
  Search,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const inviteCodeList = ref([])
const open = ref(false)
const batchOpen = ref(false)
const loading = ref(true)
const showSearch = ref(true)
const ids = ref([])
const single = ref(true)
const multiple = ref(true)
const total = ref(0)
const title = ref("")

// 会员用户信息存储
const memberUserMap = ref(new Map())

// 表单引用
const inviteCodeFormRef = ref()
const batchFormRef = ref()
const queryFormRef = ref()

const data = reactive({
  form: {},
  batchForm: {},
  queryParams: {
    pageNum: 1,
    pageSize: 10,
    inviteCode: undefined,
    status: undefined,
    used: undefined
  },
  rules: {
    inviteCode: [
      { required: true, message: "邀请码不能为空", trigger: "blur" }
    ],
    memberUserId: [
      { required: true, message: "", trigger: "blur" }
    ]
  },
  batchRules: {
    memberUserId: [
      { required: true, message: "", trigger: "blur" }
    ],
    count: [
      { required: true, message: "生成数量不能为空", trigger: "blur" }
    ]
  }
})

const { queryParams, form, batchForm, rules, batchRules } = toRefs(data)

/** 查询邀请码列表 */
function getList() {
  loading.value = true
  listInviteCode(queryParams.value).then(response => {
    inviteCodeList.value = response.rows || response.list || []
    total.value = response.total
    loading.value = false
    // 加载会员用户信息用于显示
    loadMemberUserInfo()
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

// 取消批量生成
function cancelBatch() {
  batchOpen.value = false
  resetBatch()
}

// 表单重置
function reset() {
  form.value = {
    id: undefined,
    inviteCode: undefined,
    memberUserId: undefined,
    parentInviteCode: undefined,
    giftApiCount: 10,
    status: 0,
    expireTime: undefined,
    remark: undefined
  }
  nextTick(() => {
    inviteCodeFormRef.value?.resetFields()
  })
}

// 批量表单重置
function resetBatch() {
  batchForm.value = {
    memberUserId: undefined,
    count: 1,
    parentInviteCode: undefined
  }
  nextTick(() => {
    batchFormRef.value?.resetFields()
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
  ids.value = selection.map(item => item.id)
  single.value = selection.length != 1
  multiple.value = !selection.length
}

/** 新增按钮操作 */
function handleAdd() {
  reset()
  open.value = true
  title.value = "添加邀请码"
}

/** 修改按钮操作 */
function handleUpdate(row) {
  reset()
  const _id = row.id || ids.value[0]
  getInviteCode(_id).then(response => {
    form.value = response.data
    open.value = true
    title.value = "修改邀请码"
  })
}

/** 提交按钮 */
function submitForm() {
  inviteCodeFormRef.value?.validate(valid => {
    if (valid) {
      if (form.value.id != undefined) {
        updateInviteCode(form.value).then(response => {
          ElMessage.success("修改成功")
          open.value = false
          getList()
        })
      } else {
        addInviteCode(form.value).then(response => {
          ElMessage.success("新增成功")
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
  ElMessageBox.confirm('是否确认删除邀请码编号为"' + _ids + '"的数据项？', '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    return delInviteCode(_ids)
  }).then(() => {
    getList()
    ElMessage.success("删除成功")
  }).catch(() => {})
}

/** 批量生成按钮操作 */
function handleBatchGenerate() {
  resetBatch()
  batchOpen.value = true
}

/** 提交批量生成 */
function submitBatchForm() {
  batchFormRef.value?.validate(valid => {
    if (valid) {
      batchGenerateInviteCode(batchForm.value.memberUserId, batchForm.value.count, batchForm.value.parentInviteCode).then(response => {
        ElMessage.success("批量生成成功")
        batchOpen.value = false
        getList()
      })
    }
  })
}

// 会员用户选择变化处理
function handleMemberUserChange(memberUser) {
  if (memberUser) {
    memberUserMap.value.set(memberUser.id, memberUser)
  }
}

// 批量生成会员用户选择变化处理
function handleBatchMemberUserChange(memberUser) {
  if (memberUser) {
    memberUserMap.value.set(memberUser.id, memberUser)
  }
}

// 获取会员用户显示名称
function getMemberUserDisplayName(memberUserId) {
  if (!memberUserId) return '-'
  const memberUser = memberUserMap.value.get(memberUserId)
  if (memberUser) {
    return memberUser.realName || memberUser.userName || memberUserId
  }
  return memberUserId
}

// 加载会员用户信息（用于列表显示）
function loadMemberUserInfo() {
  const memberUserIds = [...new Set(inviteCodeList.value.map(item => item.memberUserId).filter(id => id))]
  if (memberUserIds.length === 0) return
  
  // 这里可以批量查询会员用户信息，暂时使用单个查询
  memberUserIds.forEach(memberUserId => {
    if (!memberUserMap.value.has(memberUserId)) {
      // 可以在这里添加批量查询会员用户信息的逻辑
    }
  })
}

// 生成6位随机邀请码
function generateRandomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 表单生成邀请码
function generateFormInviteCode() {
  form.value.inviteCode = generateRandomCode()
}

getList()
</script>

<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryFormRef" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="邀请码" prop="inviteCode">
        <el-input
          v-model="queryParams.inviteCode"
          placeholder="请输入邀请码"
          clearable
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="邀请码状态" clearable>
          <el-option label="正常" value="0" />
          <el-option label="停用" value="1" />
        </el-select>
      </el-form-item>
      <el-form-item label="使用状态" prop="used">
        <el-select v-model="queryParams.used" placeholder="使用状态" clearable>
          <el-option label="未使用" value="0" />
          <el-option label="已使用" value="1" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="handleQuery">搜索</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button
          type="primary"
          plain
          :icon="Plus"
          @click="handleAdd"
        >
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
      <el-col :span="1.5">
        <el-button
          type="warning"
          plain
          :icon="Download"
          @click="handleBatchGenerate"
        >
批量生成
</el-button>
      </el-col>
    </el-row>

    <el-table v-loading="loading" :data="inviteCodeList" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column label="邀请码" align="center" prop="inviteCode" width="120" />
      <el-table-column label="所属会员" align="center" prop="memberUserId" width="150">
        <template #default="scope">
          <span>{{ getMemberUserDisplayName(scope.row.memberUserId) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="父邀请码" align="center" prop="parentInviteCode" width="120" />
      <el-table-column label="福利API次数" align="center" prop="giftApiCount" width="120">
        <template #default="scope">
          <el-tag type="success">{{ scope.row.giftApiCount || 0 }}次</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" align="center" prop="status" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.status === 0 ? 'success' : 'danger'">
            {{ scope.row.status === 0 ? '正常' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="使用状态" align="center" prop="used" width="100">
        <template #default="scope">
          <el-tag :type="scope.row.used === 0 ? 'info' : 'success'">
            {{ scope.row.used === 0 ? '未使用' : '已使用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="使用时间" align="center" prop="usedTime" width="180">
        <template #default="scope">
          <span>{{ scope.row.usedTime ? parseTime(scope.row.usedTime, '{y}-{m}-{d} {h}:{i}:{s}') : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="过期时间" align="center" prop="expireTime" width="180">
        <template #default="scope">
          <span>{{ scope.row.expireTime ? parseTime(scope.row.expireTime, '{y}-{m}-{d}') : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" align="center" prop="createTime" width="180">
        <template #default="scope">
          <span>{{ parseTime(scope.row.createTime, '{y}-{m}-{d} {h}:{i}:{s}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" class-name="small-padding fixed-width" width="180" fixed="right">
        <template #default="scope">
          <el-button link type="primary" :icon="EditIcon" @click="handleUpdate(scope.row)">修改</el-button>
          <el-button link type="danger" :icon="Delete" @click="handleDelete(scope.row)">删除</el-button>
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

    <!-- 添加或修改邀请码对话框 -->
    <el-dialog :title="title" v-model="open" width="500px" append-to-body>
      <el-form ref="inviteCodeFormRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="邀请码" prop="inviteCode">
          <el-input v-model="form.inviteCode" placeholder="请输入邀请码">
            <template #append>
              <el-button 
                type="primary" 
                icon="Refresh" 
                @click="generateFormInviteCode"
                title="生成随机邀请码"
              >
                生成
              </el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="所属会员" prop="memberUserId">
          <MemberUserSelect 
            v-model="form.memberUserId" 
            placeholder="请选择会员用户"
            @change="handleMemberUserChange"
          />
        </el-form-item>
        <el-form-item label="父邀请码" prop="parentInviteCode">
          <el-input v-model="form.parentInviteCode" placeholder="请输入父邀请码" />
        </el-form-item>
        <el-form-item label="福利API次数" prop="giftApiCount">
          <el-input-number 
            v-model="form.giftApiCount" 
            :min="0" 
            :max="1000" 
            placeholder="使用该邀请码注册可获得的免费API调用次数"
          />
          <div style=" margin-top: 5px; font-size: 12px;color: #909399;">
            使用该邀请码注册的用户可获得的免费API调用次数
          </div>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="form.status">
            <el-radio :value="0">正常</el-radio>
            <el-radio :value="1">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="过期时间" prop="expireTime">
          <el-date-picker 
            v-model="form.expireTime"
            type="date"
            placeholder="请选择过期时间"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" placeholder="请输入内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancel">取 消</el-button>
          <el-button type="primary" @click="submitForm">确 定</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 批量生成邀请码对话框 -->
    <el-dialog title="批量生成邀请码" v-model="batchOpen" width="400px" append-to-body>
      <el-form ref="batchFormRef" :model="batchForm" :rules="batchRules" label-width="100px">
        <el-form-item label="会员用户" prop="memberUserId">
          <MemberUserSelect 
            v-model="batchForm.memberUserId" 
            placeholder="请选择会员用户"
            @change="handleBatchMemberUserChange"
          />
        </el-form-item>
        <el-form-item label="生成数量" prop="count">
          <el-input-number v-model="batchForm.count" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="父邀请码" prop="parentInviteCode">
          <el-input v-model="batchForm.parentInviteCode" placeholder="请输入父邀请码（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancelBatch">取 消</el-button>
          <el-button type="primary" @click="submitBatchForm">确 定</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
