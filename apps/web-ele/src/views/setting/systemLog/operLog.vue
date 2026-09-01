<script>
  import { defineComponent, onMounted, reactive, toRefs } from 'vue'

  import { getOperLogList } from '@/api/systemLog'
  import { Search } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'OperLog',
    setup() {
      const state = reactive({
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        queryForm: {
          account: '',
          title: '',
          pageNum: 1,
          pageSize: 20,
        },
      })

      const fetchData = async () => {
        state.listLoading = true
        try {
          const res = await getOperLogList(state.queryForm)
          state.list = res?.list ?? res?.data?.list ?? res?.rows ?? []
          state.total = res?.total ?? res?.data?.total ?? 0
        } finally {
          state.listLoading = false
        }
      }

      const getBusinessType = (row) => {
        const businessType = row.businessType
        if (businessType == '0') {
          return '其他'
        } else if (businessType == '1') {
          return '新增'
        } else if (businessType == '2') {
          return '修改'
        } else if (businessType == '3') {
          return '删除'
        }
        return businessType
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
        getBusinessType,
      }
    },
  })
</script>

<template>
  <div class="system-log-management-container">
    <vab-query-form>
      <vab-query-form-top-panel>
        <el-form inline label-width="70px" :model="queryForm" @submit.prevent>
          <el-form-item label="操作用户">
            <el-input v-model.trim="queryForm.account" clearable />
          </el-form-item>
          <el-form-item label="模块名称">
            <el-input v-model.trim="queryForm.title" clearable />
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
          <el-row :gutter="12">
            <el-col :span="12">
              <div class="vab-table-expand">
                <p>
                  <span class="vab-table-expand-title">操作模块:</span>
                  {{ row.title }}
                </p>
                <p>
                  <span class="vab-table-expand-title">操作类型:</span>
                  {{ getBusinessType(row) }}
                </p>
                <p>
                  <span class="vab-table-expand-title">操作用户:</span>
                  {{ row.operName }}
                </p>
                <p>
                  <span class="vab-table-expand-title">IP:</span>
                  {{ row.operIp }}
                </p>
                <p>
                  <span class="vab-table-expand-title">操作时间:</span>
                  {{ row.operTime }}
                </p>
                <p>
                  <span class="vab-table-expand-title">返回结果:</span>
                  <span v-if="row.status == 0">
                    <span class="vab-dot vab-dot-success"><span></span></span>
                    {{ row.jsonResult }}
                  </span>
                  <span v-else>
                    <span class="vab-dot vab-dot-error"><span></span></span>
                    {{ row.errorMsg }}
                  </span>
                </p>
              </div>
            </el-col>
            <el-col :span="12">
              <div class="vab-table-expand">
                <p>
                  <span class="vab-table-expand-title">请求地址:</span>
                  {{ row.operUrl }}
                </p>
                <p>
                  <span class="vab-table-expand-title">请求方式:</span>
                  {{ row.requestMethod }}
                </p>
                <p>
                  <span class="vab-table-expand-title">请求方法:</span>
                  {{ row.method }}
                </p>
                <p>
                  <span class="vab-table-expand-title">请求参数:</span>
                  {{ row.operParam }}
                </p>
              </div>
            </el-col>
          </el-row>
        </template>
      </el-table-column>
      <el-table-column label="操作模块" prop="title" min-width="120" />
      <el-table-column
        label="操作类型"
        prop="businessType"
        width="100"
        :formatter="getBusinessType"
      />
      <el-table-column label="操作用户" prop="operName" width="120" />
      <el-table-column
        label="请求地址"
        prop="operUrl"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column
        label="返回结果"
        prop="status"
        min-width="160"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span v-if="row.status == 0">
            <span class="vab-dot vab-dot-success"><span></span></span>
            {{ row.jsonResult }}
          </span>
          <span v-else>
            <span class="vab-dot vab-dot-error"><span></span></span>
            {{ row.errorMsg }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作IP" prop="operIp" width="130" />
      <el-table-column
        label="操作时间"
        prop="operTime"
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
