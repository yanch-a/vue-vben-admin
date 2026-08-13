<script>
  import {
    computed,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'
  import { useRoute, useRouter } from 'vue-router'

  import { useTabbarStore } from '@vben/stores'

  import { getMemberLevelList } from '@/api/member/memberLevelApi'
  import { cancelOrder, getOrderById, getPaymentRecord, queryOrderStatus } from '@/api/member/memberOrderApi'
  import { backToListPage } from '@/utils/route-back'
  import { Close, Refresh } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'MemberOrderDetail',
    setup() {
      const $baseMessage = inject('$baseMessage')
      const $baseConfirm = inject('$baseConfirm')
      const route = useRoute()
      const router = useRouter()
      const tabbarStore = useTabbarStore()

      const state = reactive({
        orderInfo: {},
        paymentRecord: null,
        memberLevels: [],
        pageTitle: '订单详情',
      })

      // 会员等级名称
      const memberLevelName = computed(() => {
        if (state.orderInfo.memberLevelId && state.memberLevels.length > 0) {
          const level = state.memberLevels.find(l => l.id === state.orderInfo.memberLevelId)
          return level ? level.levelName : '-'
        }
        return '-'
      })

      // 订单类型
      const getOrderTypeName = (type) => {
        const types = { 1: '会员套餐', 2: '单次接口' }
        return types[type] || '未知'
      }

      // 套餐类型
      const getPackageTypeName = (type) => {
        const types = { 1: '月费', 2: '季费', 3: '半年费', 4: '年费' }
        return types[type] || '-'
      }

      // 订单状态
      const getOrderStatusName = (status) => {
        const statuses = { 1: '待支付', 2: '已支付', 3: '已取消', 4: '已退款', 5: '已过期' }
        return statuses[status] || '未知'
      }

      const getOrderStatusType = (status) => {
        const types = { 1: 'warning', 2: 'success', 3: 'info', 4: 'danger', 5: 'info' }
        return types[status] || ''
      }

      // 支付状态
      const getPayStatusName = (status) => {
        const statuses = { 0: '未支付', 1: '支付中', 2: '支付成功', 3: '支付失败' }
        return statuses[status] || '未知'
      }

      const getPayStatusType = (status) => {
        const types = { 0: 'info', 1: 'warning', 2: 'success', 3: 'danger' }
        return types[status] || ''
      }

      // 支付方式
      const getPayMethodName = (method) => {
        const methods = { 'ALIPAY': '支付宝', 'WECHAT': '微信支付' }
        return methods[method] || method || '-'
      }

      // 支付渠道
      const getPayChannelName = (channel) => {
        const channels = {
          'ALI_QR': '支付宝扫码',
          'WX_NATIVE': '微信扫码',
          'ALI_APP': '支付宝APP',
          'WX_APP': '微信APP'
        }
        return channels[channel] || channel || '-'
      }

      // 退款状态
      const getRefundStatusName = (status) => {
        const statuses = { 0: '未退款', 1: '退款中', 2: '退款成功', 3: '退款失败' }
        return statuses[status] || '未知'
      }

      const getRefundStatusType = (status) => {
        const types = { 0: 'info', 1: 'warning', 2: 'success', 3: 'danger' }
        return types[status] || ''
      }

      // 返回
      const goBack = async () => {
        await backToListPage(route, router, {
          listRouteName: 'MemberOrder',
          fallbackPath: '/member/memberOrder',
        })
      }

      // 刷新订单状态
      const refreshOrder = async () => {
        try {
          const { data } = await queryOrderStatus({ orderNo: state.orderInfo.orderNo })
          if (data) {
            state.orderInfo = data
            $baseMessage('订单状态已刷新', 'success', 'vab-hey-message-success')
            
            // 如果支付状态变化，重新获取支付记录
            if (data.payStatus === 2) {
              await loadPaymentRecord()
            }
          }
        } catch (error) {
          $baseMessage('刷新失败', 'error', 'vab-hey-message-error')
        }
      }

      // 取消订单
      const handleCancelOrder = () => {
        $baseConfirm('确定要取消这个订单吗？', null, async () => {
          try {
            const { msg } = await cancelOrder({ orderNo: state.orderInfo.orderNo })
            $baseMessage(msg || '取消成功', 'success', 'vab-hey-message-success')
            await refreshOrder()
          } catch (error) {
            $baseMessage(error.message || '取消失败', 'error', 'vab-hey-message-error')
          }
        })
      }

      // 加载支付记录
      const loadPaymentRecord = async () => {
        if (!state.orderInfo.orderNo) return
        
        try {
          const { data } = await getPaymentRecord({ orderNo: state.orderInfo.orderNo })
          state.paymentRecord = data
        } catch (error) {
          console.error('获取支付记录失败:', error)
        }
      }

      // 加载数据
      const fetchData = async () => {
        try {
          // 加载会员等级列表
          const { data: levels } = await getMemberLevelList({})
          state.memberLevels = levels || []

          // 加载订单详情
          if (route.query.id) {
            const { data } = await getOrderById({ id: route.query.id })
            state.orderInfo = data
            
            // 加载支付记录
            await loadPaymentRecord()
          }
        } catch (error) {
          console.error('加载数据失败:', error)
          $baseMessage('加载数据失败', 'error', 'vab-hey-message-error')
        }
      }

      onMounted(() => {
        const title = route.query.title || '订单详情'
        state.pageTitle = title
        tabbarStore.setTabTitle(route, String(title))
        fetchData()
      })

      return {
        ...toRefs(state),
        memberLevelName,
        goBack,
        refreshOrder,
        handleCancelOrder,
        getOrderTypeName,
        getPackageTypeName,
        getOrderStatusName,
        getOrderStatusType,
        getPayStatusName,
        getPayStatusType,
        getPayMethodName,
        getPayChannelName,
        getRefundStatusName,
        getRefundStatusType,
        Refresh,
        Close,
      }
    },
  })
</script>

<template>
  <div class="order-detail-container">
    <el-page-header :content="pageTitle" @back="goBack" />

    <el-card shadow="never" class="info-card">
      <template #header>
        <div class="card-header">
          <span>订单信息</span>
          <div class="status-badges">
            <el-tag :type="getOrderStatusType(orderInfo.orderStatus)" size="large">
              {{ getOrderStatusName(orderInfo.orderStatus) }}
            </el-tag>
            <el-tag :type="getPayStatusType(orderInfo.payStatus)" size="large" style="margin-left: 10px;">
              {{ getPayStatusName(orderInfo.payStatus) }}
            </el-tag>
          </div>
        </div>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item label="订单号">
          <el-text type="primary" size="large" style="font-weight: 600;">
            {{ orderInfo.orderNo }}
          </el-text>
        </el-descriptions-item>
        <el-descriptions-item label="订单类型">
          <el-tag :type="orderInfo.orderType === 1 ? 'success' : 'info'">
            {{ getOrderTypeName(orderInfo.orderType) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="订单描述" :span="2">
          {{ orderInfo.orderDesc }}
        </el-descriptions-item>
        
        <!-- 会员套餐订单信息 -->
        <template v-if="orderInfo.orderType === 1">
          <el-descriptions-item label="会员等级">
            {{ memberLevelName }}
          </el-descriptions-item>
          <el-descriptions-item label="套餐类型">
            {{ getPackageTypeName(orderInfo.packageType) }}
          </el-descriptions-item>
        </template>
        
        <!-- 单次接口订单信息 -->
        <template v-if="orderInfo.orderType === 2">
          <el-descriptions-item label="API调用次数">
            {{ orderInfo.apiCount }} 次
          </el-descriptions-item>
          <el-descriptions-item label="单价">
            ¥9.9/次
          </el-descriptions-item>
        </template>
        
        <el-descriptions-item label="订单金额">
          <span class="amount-text">¥{{ orderInfo.orderAmount }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="优惠金额">
          <span class="discount-text">-¥{{ orderInfo.discountAmount || '0.00' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="实付金额" :span="2">
          <span class="actual-amount">¥{{ orderInfo.actualAmount }}</span>
        </el-descriptions-item>
        
        <el-descriptions-item label="创建时间">
          {{ orderInfo.createTime }}
        </el-descriptions-item>
        <el-descriptions-item label="支付时间">
          {{ orderInfo.payTime || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="过期时间">
          {{ orderInfo.expireTime || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="取消时间">
          {{ orderInfo.cancelTime || '-' }}
        </el-descriptions-item>
        
        <el-descriptions-item label="备注" :span="2">
          {{ orderInfo.remark || '-' }}
        </el-descriptions-item>
      </el-descriptions>

      <div class="action-buttons" v-if="orderInfo.orderStatus === 1">
        <el-button type="primary" :icon="Refresh" @click="refreshOrder">
          刷新订单状态
        </el-button>
        <el-button type="warning" :icon="Close" @click="handleCancelOrder">
          取消订单
        </el-button>
      </div>
    </el-card>

    <!-- 支付记录 -->
    <el-card shadow="never" class="payment-card" v-if="paymentRecord">
      <template #header>
        <div class="card-header">
          <span>支付记录</span>
        </div>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item label="支付流水号">
          <el-text type="primary" style="font-weight: 600;">
            {{ paymentRecord.paymentNo }}
          </el-text>
        </el-descriptions-item>
        <el-descriptions-item label="支付状态">
          <el-tag :type="getPayStatusType(paymentRecord.payStatus)">
            {{ getPayStatusName(paymentRecord.payStatus) }}
          </el-tag>
        </el-descriptions-item>
        
        <el-descriptions-item label="支付方式">
          {{ getPayMethodName(paymentRecord.payMethod) }}
        </el-descriptions-item>
        <el-descriptions-item label="支付渠道">
          {{ getPayChannelName(paymentRecord.payChannel) }}
        </el-descriptions-item>
        
        <el-descriptions-item label="支付金额">
          <span class="amount-text">¥{{ paymentRecord.payAmount }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="JEEPAY订单ID">
          {{ paymentRecord.jeepayOrderId || '-' }}
        </el-descriptions-item>
        
        <el-descriptions-item label="支付时间">
          {{ paymentRecord.payTime || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="回调时间">
          {{ paymentRecord.callbackTime || '-' }}
        </el-descriptions-item>
        
        <!-- 二维码URL -->
        <el-descriptions-item label="二维码URL" :span="2" v-if="paymentRecord.qrCodeUrl">
          <el-link :href="paymentRecord.qrCodeUrl" type="primary" target="_blank">
            {{ paymentRecord.qrCodeUrl }}
          </el-link>
        </el-descriptions-item>
        
        <!-- 错误信息 -->
        <el-descriptions-item 
          label="错误信息" 
          :span="2" 
          v-if="paymentRecord.errorMsg"
        >
          <el-text type="danger">{{ paymentRecord.errorMsg }}</el-text>
        </el-descriptions-item>
        
        <!-- 退款信息 -->
        <template v-if="paymentRecord.refundStatus > 0">
          <el-descriptions-item label="退款状态">
            <el-tag :type="getRefundStatusType(paymentRecord.refundStatus)">
              {{ getRefundStatusName(paymentRecord.refundStatus) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="退款金额">
            <span class="refund-amount">¥{{ paymentRecord.refundAmount || '0.00' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="退款时间" :span="2">
            {{ paymentRecord.refundTime || '-' }}
          </el-descriptions-item>
        </template>
        
        <el-descriptions-item label="创建时间">
          {{ paymentRecord.createTime }}
        </el-descriptions-item>
        <el-descriptions-item label="更新时间">
          {{ paymentRecord.updateTime || '-' }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- JEEPAY响应数据 -->
      <div class="response-data" v-if="paymentRecord.jeepayResponse">
        <el-divider content-position="left">JEEPAY响应数据</el-divider>
        <el-input
          v-model="paymentRecord.jeepayResponse"
          type="textarea"
          :rows="6"
          readonly
        />
      </div>

      <!-- 回调数据 -->
      <div class="callback-data" v-if="paymentRecord.callbackData">
        <el-divider content-position="left">支付回调数据</el-divider>
        <el-input
          v-model="paymentRecord.callbackData"
          type="textarea"
          :rows="6"
          readonly
        />
      </div>
    </el-card>

    <!-- 没有支付记录的提示 -->
    <el-card shadow="never" class="payment-card" v-else>
      <el-empty description="暂无支付记录" />
    </el-card>
  </div>
</template>

<style scoped lang="scss">
.order-detail-container {
  padding: 20px;

  .el-page-header {
    margin-bottom: 20px;
  }

  .info-card,
  .payment-card {
    margin-bottom: 20px;

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 16px;
      font-weight: 600;

      .status-badges {
        display: flex;
        gap: 10px;
      }
    }

    .amount-text {
      font-size: 16px;
      font-weight: 600;
      color: #666;
    }

    .discount-text {
      font-size: 16px;
      font-weight: 600;
      color: #67c23a;
    }

    .actual-amount {
      font-size: 20px;
      font-weight: 700;
      color: #f56c6c;
    }

    .refund-amount {
      font-size: 16px;
      font-weight: 600;
      color: #e6a23c;
    }

    .action-buttons {
      margin-top: 20px;
      text-align: center;

      .el-button {
        margin: 0 10px;
      }
    }

    .response-data,
    .callback-data {
      margin-top: 20px;

      .el-divider {
        margin: 20px 0 10px;
      }
    }
  }
}
</style>

