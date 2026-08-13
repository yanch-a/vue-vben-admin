<script>
  import {
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'
  import { useRouter } from 'vue-router'

  import { cancelOrder, getOrderPage } from '@/api/member/memberOrderApi'
  import { Close, Refresh, Search, View } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'MemberOrderManage',
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')
      const router = useRouter()

      const state = reactive({
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        queryForm: {
          pageNum: 1,
          pageSize: 10,
          orderNo: '',
          memberUserId: '',
          orderType: null,
          orderStatus: null,
          payStatus: null,
        },
      })

      // 订单类型名称
      const getOrderTypeName = (type) => {
        const types = {
          1: '会员套餐',
          2: '单次接口',
        }
        return types[type] || '未知'
      }

      // 订单状态名称
      const getOrderStatusName = (status) => {
        const statuses = {
          1: '待支付',
          2: '已支付',
          3: '已取消',
          4: '已退款',
          5: '已过期',
        }
        return statuses[status] || '未知'
      }

      // 订单状态标签类型
      const getOrderStatusType = (status) => {
        const types = {
          1: 'warning',
          2: 'success',
          3: 'info',
          4: 'danger',
          5: 'info',
        }
        return types[status] || ''
      }

      // 支付状态名称
      const getPayStatusName = (status) => {
        const statuses = {
          0: '未支付',
          1: '支付中',
          2: '支付成功',
          3: '支付失败',
        }
        return statuses[status] || '未知'
      }

      // 支付状态标签类型
      const getPayStatusType = (status) => {
        const types = {
          0: 'info',
          1: 'warning',
          2: 'success',
          3: 'danger',
        }
        return types[status] || ''
      }

      // 表格行样式
      const tableRowClassName = ({ row }) => {
        if (row.payStatus === 2) {
          return 'success-row'
        } else if (row.orderStatus === 5 || row.payStatus === 3) {
          return 'expired-row'
        }
        return ''
      }

      // 查看详情
      const handleView = (row) => {
        router.push({
          path: '/member/memberOrder/detail',
          query: {
            id: row.id,
            orderNo: row.orderNo,
            title: '订单详情',
            timestamp: new Date().getTime(),
          },
        })
      }

      // 取消订单
      const handleCancel = (row) => {
        $baseConfirm('确定要取消这个订单吗？', null, async () => {
          try {
            const { msg } = await cancelOrder({ orderNo: row.orderNo })
            $baseMessage(
              msg || '取消成功',
              'success',
              'vab-hey-message-success'
            )
            await fetchData()
          } catch (error) {
            $baseMessage(
              error.message || '取消失败',
              'error',
              'vab-hey-message-error'
            )
          }
        })
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

      const fetchData = async () => {
        state.listLoading = true
        try {
          const { list, total } = await getOrderPage(state.queryForm)
          state.list = list || []
          state.total = total || 0
        } catch (error) {
          console.error('获取订单列表失败:', error)
          $baseMessage('获取订单列表失败', 'error', 'vab-hey-message-error')
        } finally {
          state.listLoading = false
        }
      }

      onMounted(() => {
        fetchData()
      })

      return {
        ...toRefs(state),
        handleView,
        handleCancel,
        handleSizeChange,
        handleCurrentChange,
        queryData,
        fetchData,
        getOrderTypeName,
        getOrderStatusName,
        getOrderStatusType,
        getPayStatusName,
        getPayStatusType,
        tableRowClassName,
        Refresh,
        Search,
        View,
        Close,
      }
    },
  })
</script>

<template>
  <div class="order-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="4">
        <el-button :icon="Refresh" @click="fetchData">刷新</el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="20">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.orderNo"
              clearable
              placeholder="请输入订单号"
            />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.memberUserId"
              clearable
              placeholder="会员用户ID"
            />
          </el-form-item>
          <el-form-item>
            <el-select
              v-model="queryForm.orderType"
              clearable
              placeholder="订单类型"
            >
              <el-option label="全部" :value="null" />
              <el-option label="会员套餐" :value="1" />
              <el-option label="单次接口" :value="2" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select
              v-model="queryForm.orderStatus"
              clearable
              placeholder="订单状态"
            >
              <el-option label="全部" :value="null" />
              <el-option label="待支付" :value="1" />
              <el-option label="已支付" :value="2" />
              <el-option label="已取消" :value="3" />
              <el-option label="已退款" :value="4" />
              <el-option label="已过期" :value="5" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select
              v-model="queryForm.payStatus"
              clearable
              placeholder="支付状态"
            >
              <el-option label="全部" :value="null" />
              <el-option label="未支付" :value="0" />
              <el-option label="支付中" :value="1" />
              <el-option label="支付成功" :value="2" />
              <el-option label="支付失败" :value="3" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Search" type="primary" @click="queryData">
              查询
            </el-button>
          </el-form-item>
        </el-form>
      </vab-query-form-right-panel>
    </vab-query-form>

    <el-table
      v-loading="listLoading"
      border
      :data="list"
      :row-class-name="tableRowClassName"
    >
      <el-table-column
        align="center"
        label="订单号"
        prop="orderNo"
        width="180"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-button link type="primary" @click="handleView(row)">
            {{ row.orderNo }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="订单类型"
        prop="orderType"
        width="100"
      >
        <template #default="{ row }">
          <el-tag :type="row.orderType === 1 ? 'success' : 'info'">
            {{ getOrderTypeName(row.orderType) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="订单描述"
        prop="orderDesc"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="订单金额"
        prop="orderAmount"
        width="100"
      >
        <template #default="{ row }">
          <span class="amount-text">¥{{ row.orderAmount }}</span>
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="实付金额"
        prop="actualAmount"
        width="100"
      >
        <template #default="{ row }">
          <span class="amount-text primary">¥{{ row.actualAmount }}</span>
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="订单状态"
        prop="orderStatus"
        width="100"
      >
        <template #default="{ row }">
          <el-tag :type="getOrderStatusType(row.orderStatus)">
            {{ getOrderStatusName(row.orderStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="支付状态"
        prop="payStatus"
        width="100"
      >
        <template #default="{ row }">
          <el-tag :type="getPayStatusType(row.payStatus)">
            {{ getPayStatusName(row.payStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="会员ID"
        prop="memberUserId"
        width="160"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="创建时间"
        prop="createTime"
        width="160"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="支付时间"
        prop="payTime"
        width="160"
        show-overflow-tooltip
      />
      <el-table-column align="center" label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button
            :icon="View"
            circle
            text
            type="primary"
            @click="handleView(row)"
          />
          <el-button
            v-if="row.orderStatus === 1"
            :icon="Close"
            circle
            text
            type="warning"
            @click="handleCancel(row)"
          />
        </template>
      </el-table-column>
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

<style scoped lang="scss">
  .order-management-container {
    padding: 20px;

    .amount-text {
      font-weight: 600;
      color: #666;

      &.primary {
        font-size: 16px;
        color: #f56c6c;
      }
    }

    :deep(.success-row) {
      background-color: #f0f9ff;
    }

    :deep(.expired-row) {
      color: #999;
      background-color: #f5f5f5;
    }
  }
</style>
