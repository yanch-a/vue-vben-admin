<script setup>
  /**
   * 会员分组（部门）增删改查
   * @author yanch
   */
  import { nextTick, reactive, ref, toRefs } from 'vue'

  import {
    addMemberUserGroup,
    delMemberUserGroup,
    getMemberUserGroup,
    listMemberUserGroup,
    listMemberUsersByGroup,
    updateMemberUserGroup,
  } from '@/api/member/memberUserGroup'
  import { parseTime } from '@/utils'
  import {
    Delete,
    Edit as EditIcon,
    EditPen,
    Plus,
    Refresh,
    Search,
    User,
  } from '@element-plus/icons-vue'
  import { ElMessage, ElMessageBox } from 'element-plus'

  const groupList = ref([])
  const open = ref(false)
  const loading = ref(true)
  const ids = ref([])
  const single = ref(true)
  const multiple = ref(true)
  const total = ref(0)
  const title = ref('')
  const formRef = ref()
  const queryFormRef = ref()

  const membersVisible = ref(false)
  const membersLoading = ref(false)
  const members = ref([])
  const membersTitle = ref('')

  const data = reactive({
    form: {},
    queryParams: {
      pageNum: 1,
      pageSize: 10,
      groupName: undefined,
    },
    rules: {
      groupName: [
        { required: true, message: '组名称不能为空', trigger: 'blur' },
      ],
      orderNum: [{ required: true, message: '排序不能为空', trigger: 'blur' }],
    },
  })

  const { queryParams, form, rules } = toRefs(data)

  function getList() {
    loading.value = true
    listMemberUserGroup(queryParams.value)
      .then((response) => {
        groupList.value = response.rows || response.list || []
        total.value = response.total || 0
      })
      .finally(() => {
        loading.value = false
      })
  }

  function handleSizeChange(size) {
    queryParams.value.pageSize = size
    queryParams.value.pageNum = 1
    getList()
  }

  function handleCurrentChange(page) {
    queryParams.value.pageNum = page
    getList()
  }

  function reset() {
    form.value = {
      id: undefined,
      groupName: undefined,
      description: undefined,
      orderNum: 0,
    }
    nextTick(() => {
      formRef.value?.resetFields()
    })
  }

  function handleQuery() {
    queryParams.value.pageNum = 1
    getList()
  }

  function resetQuery() {
    queryFormRef.value?.resetFields()
    handleQuery()
  }

  function handleSelectionChange(selection) {
    ids.value = selection.map((item) => item.id)
    single.value = selection.length !== 1
    multiple.value = !selection.length
  }

  function handleAdd() {
    reset()
    open.value = true
    title.value = '新增会员分组'
  }

  function handleUpdate(row) {
    reset()
    const id = row?.id ?? ids.value[0]
    getMemberUserGroup(id).then((response) => {
      form.value = response.data || {}
      open.value = true
      title.value = '修改会员分组'
    })
  }

  function submitForm() {
    formRef.value?.validate((valid) => {
      if (!valid) return
      const req = form.value.id
        ? updateMemberUserGroup(form.value)
        : addMemberUserGroup(form.value)
      req.then(() => {
        ElMessage.success(form.value.id ? '修改成功' : '新增成功')
        open.value = false
        getList()
      })
    })
  }

  function handleDelete(row) {
    const _ids = row?.id || ids.value
    ElMessageBox.confirm(`是否确认删除会员分组「${row?.groupName || _ids}」？`, '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => delMemberUserGroup(_ids))
      .then(() => {
        getList()
        ElMessage.success('删除成功')
      })
      .catch(() => {})
  }

  /** 查看组内会员，便于核对授权范围 */
  function handleViewMembers(row) {
    membersTitle.value = `${row.groupName} — 组内会员`
    membersVisible.value = true
    membersLoading.value = true
    listMemberUsersByGroup(row.id)
      .then((res) => {
        members.value = res.data || []
      })
      .finally(() => {
        membersLoading.value = false
      })
  }

  getList()
</script>

<template>
  <!-- 与会员管理等列表页统一：vab-query-form 左操作 + 右筛选 -->
  <div class="config-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="8">
        <el-button :icon="Plus" type="primary" @click="handleAdd">新增</el-button>
        <el-button
          :icon="EditPen"
          type="success"
          :disabled="single"
          @click="handleUpdate()"
        >
          修改
        </el-button>
        <el-button
          :icon="Delete"
          type="danger"
          :disabled="multiple"
          @click="handleDelete()"
        >
          删除
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="16">
        <el-form ref="queryFormRef" inline :model="queryParams" @submit.prevent>
          <el-form-item prop="groupName">
            <el-input
              v-model.trim="queryParams.groupName"
              clearable
              placeholder="请输入组名称"
              @keyup.enter="handleQuery"
            />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Search" type="primary" @click="handleQuery">
              查询
            </el-button>
            <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
          </el-form-item>
        </el-form>
      </vab-query-form-right-panel>
    </vab-query-form>

    <el-table
      v-loading="loading"
      border
      :data="groupList"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column label="组名称" align="center" prop="groupName" min-width="140" />
      <el-table-column
        label="描述"
        align="center"
        prop="description"
        min-width="200"
        show-overflow-tooltip
      />
      <el-table-column label="排序" align="center" prop="orderNum" width="80" />
      <el-table-column label="创建时间" align="center" prop="createTime" width="180">
        <template #default="scope">
          <span>{{ parseTime(scope.row.createTime, '{y}-{m}-{d} {h}:{i}:{s}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" width="220" fixed="right">
        <template #default="scope">
          <el-button
            circle
            text
            type="primary"
            :icon="User"
            title="成员"
            @click="handleViewMembers(scope.row)"
          />
          <el-button
            circle
            text
            type="primary"
            :icon="EditIcon"
            title="修改"
            @click="handleUpdate(scope.row)"
          />
          <el-button
            circle
            text
            type="danger"
            :icon="Delete"
            title="删除"
            @click="handleDelete(scope.row)"
          />
        </template>
      </el-table-column>
      <template #empty>
        <el-empty class="vab-data-empty" description="暂无数据" />
      </template>
    </el-table>

    <el-pagination
      v-show="total > 0"
      background
      :current-page="queryParams.pageNum"
      :page-size="queryParams.pageSize"
      :total="total"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next, jumper"
      @size-change="handleSizeChange"
      @current-change="handleCurrentChange"
    />

    <el-dialog v-model="open" :title="title" width="520px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="组名称" prop="groupName">
          <el-input v-model="form.groupName" maxlength="100" placeholder="请输入组名称" />
        </el-form-item>
        <el-form-item label="排序" prop="orderNum">
          <el-input-number v-model="form.orderNum" :min="0" :max="9999" style="width: 100%" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="请输入描述"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">取 消</el-button>
        <el-button type="primary" @click="submitForm">确 定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="membersVisible" :title="membersTitle" width="640px" append-to-body>
      <el-table v-loading="membersLoading" :data="members" max-height="420" border>
        <el-table-column label="用户名" prop="userName" min-width="120" />
        <el-table-column label="姓名" prop="realName" min-width="100" />
        <el-table-column label="手机号" prop="phoneNumber" min-width="120" />
        <template #empty>
          <el-empty description="该组暂无会员" />
        </template>
      </el-table>
    </el-dialog>
  </div>
</template>
