<script>
  import { defineComponent, onMounted, reactive, toRefs } from 'vue'

  import { getLoginLogList } from '@/api/systemLog'
  import { Search } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'LoginLog',
    setup() {
      const state = reactive({
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        queryForm: {
          userName: '',
          pageNum: 1,
          pageSize: 20,
        },
      })

      const fetchData = async () => {
        state.listLoading = true
        try {
          const res = await getLoginLogList(state.queryForm)
          state.list = res?.list ?? res?.data?.list ?? res?.rows ?? []
          state.total = res?.total ?? res?.data?.total ?? 0
        } finally {
          state.listLoading = false
        }
      }

      const handleSizeChange = (val) => {
        state.queryForm.pageSize = val
        fetchData()
      }
      const handleCurrentChange = (val) => {
        state.queryForm.pageNum = val
        fetchData()
      }
      const queryData = () => {
        state.queryForm.pageNum = 1
        fetchData()
      }

      onMounted(() => {
        fetchData()
      })

      return {
        ...toRefs(state),
        fetchData,
        handleSizeChange,
        handleCurrentChange,
        queryData,
        Search,
      }
    },
  })
</script>

<template>
  <div class="system-log-management-container">
    <vab-query-form>
      <vab-query-form-top-panel>
        <el-form inline label-width="60px" :model="queryForm" @submit.prevent>
          <el-form-item label="账号">
            <el-input
              v-model.trim="queryForm.userName"
              clearable
              placeholder="请输入账号"
            />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Search" type="primary" @click="queryData">
              查询
            </el-button>
          </el-form-item>
        </el-form>
      </vab-query-form-top-panel>
    </vab-query-form>

    <el-table v-loading="listLoading" :data="list" border>
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="vab-table-expand">
            <p>
              <span class="vab-table-expand-title">账号:</span>
              {{ row.userName }}
            </p>
            <p>
              <span class="vab-table-expand-title">登录状态:</span>
              <span v-if="row.status === '0'">
                <span class="vab-dot vab-dot-success"><span></span></span>
                {{ row.msg }}
              </span>
              <span v-else>
                <span class="vab-dot vab-dot-error"><span></span></span>
                {{ row.msg }}
              </span>
            </p>
            <p>
              <span class="vab-table-expand-title">登录IP:</span>
              {{ row.ipaddr }}
            </p>
            <p>
              <span class="vab-table-expand-title">登录地点:</span>
              {{ row.loginLocation }}
            </p>
            <p>
              <span class="vab-table-expand-title">登录时间:</span>
              {{ row.loginTime }}
            </p>
            <p>
              <span class="vab-table-expand-title">浏览器:</span>
              {{ row.browser }}
            </p>
            <p>
              <span class="vab-table-expand-title">操作系统:</span>
              {{ row.os }}
            </p>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="账号" prop="userName" show-overflow-tooltip />
      <el-table-column
        label="执行结果"
        prop="status"
        min-width="140"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span v-if="row.status === '0'">
            <span class="vab-dot vab-dot-success"><span></span></span>
            {{ row.msg }}
          </span>
          <span v-else>
            <span class="vab-dot vab-dot-error"><span></span></span>
            {{ row.msg }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="登录IP" prop="ipaddr" width="140" />
      <el-table-column
        label="登录时间"
        prop="loginTime"
        width="170"
        show-overflow-tooltip
      />
      <template #empty>
        <el-empty class="vab-data-empty" description="暂无数据" />
      </template>
    </el-table>
    <el-pagination
      background
      :current-page="queryForm.pageNum"
      :layout="layout"
      :page-size="queryForm.pageSize"
      :total="total"
      @current-change="handleCurrentChange"
      @size-change="handleSizeChange"
    />
  </div>
</template>
