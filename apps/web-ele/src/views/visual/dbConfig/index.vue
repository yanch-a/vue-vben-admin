<script>
  import { defineComponent, inject, onMounted, reactive, ref } from 'vue'
  import { useRouter } from 'vue-router'

  import { testConnection } from '@/api/visual/database'
  import {
    deleteDbConfig,
    editDbConfig,
    getDbConfigPage,
    getVqDict,
  } from '@/api/visual/vq'
  import { ElMessage, ElMessageBox } from 'element-plus'

  export default defineComponent({
    name: 'DbConfig',
    setup() {
      const router = useRouter()
      const loading = ref(false)
      const dialogVisible = ref(false)
      const dialogType = ref('add')
      const formRef = ref(null)
      const totalNum = ref(0)
      const tableData = ref([])

      // 数据库类型选项
      const dataBaseType = ref([])

      const $baseMessage = inject('$baseMessage')
      // 表单数据
      const form = reactive({
        id: undefined,
        dbName: '',
        dbType: '',
        dbHost: '',
        dbPort: 3306,
        jdbcUrl: '',
        username: '',
        password: '',
        description: '',
        orderNum: 0,
      })

      const queryForm = reactive({
        pageNum: 1,
        pageSize: 10,
        dbName: '',
      })

      // 表单校验规则
      const rules = {
        dbName: [
          { required: true, message: '请输入数据库名称', trigger: 'blur' },
        ],
        schemaName: [
          { required: true, message: '请输入默认数据库', trigger: 'blur' },
        ],
        dbType: [
          { required: true, message: '请选择数据库类型', trigger: 'change' },
        ],
        dbHost: [
          { required: true, message: '请输入主机地址', trigger: 'blur' },
        ],
        dbPort: [{ required: true, message: '请输入端口', trigger: 'blur' }],
        // jdbcUrl: [{ required: true, message: '请输入JDBC连接URL', trigger: 'blur' }],
        username: [
          { required: true, message: '请输入用户名', trigger: 'blur' },
        ],
        password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
      }

      // 获取列表数据
      const getList = async () => {
        loading.value = true
        try {
          // 调用后端API获取数据
          const { list, total } = await getDbConfigPage(queryForm)
          tableData.value = list
          totalNum.value = total
        } catch (error) {
          $baseMessage(
            '获取数据库配置列表失败',
            'error',
            'vab-hey-message-error'
          )
        } finally {
          loading.value = false
        }
      }

      // 新增配置
      const handleAdd = () => {
        dialogType.value = 'add'
        Object.assign(form, {
          id: undefined,
          dbName: '',
          dbType: '',
          dbHost: '',
          dbPort: 3306,
          jdbcUrl: '',
          username: '',
          password: '',
          description: '',
          orderNum: 0,
        })
        dialogVisible.value = true
      }

      // 编辑配置
      const handleEdit = (row) => {
        dialogType.value = 'edit'
        Object.assign(form, row)
        dialogVisible.value = true
      }

      const testConnectionMethod = async (row) => {
        const { data } = await testConnection(row.id)
        if (data.success) {
          ElMessage.success('连接成功')
        } else {
          ElMessage.error('连接失败')
        }
      }

      // 删除配置
      const handleDelete = (row) => {
        ElMessageBox.confirm('确认删除该数据库配置吗？', '提示', {
          type: 'warning',
        }).then(async () => {
          try {
            await deleteDbConfig({ ids: row.id })
            ElMessage.success('删除成功')
            getList()
          } catch (error) {
            console.error('删除数据库配置失败:', error)
            ElMessage.error('删除数据库配置失败')
          }
        })
      }

      // 进入表分组画布
      const handleCanvas = (row) => {
        router.push({
          name: 'DbConfigCanvas',
          query: { id: row.id },
        })
      }

      // 进入关系画布（一张网）
      const handleRelationCanvas = (row) => {
        router.push({
          name: 'RelationCanvas',
          query: { id: row.id },
        })
      }

      // 提交表单
      const handleSubmit = async () => {
        if (!formRef.value) return

        await formRef.value.validate(async (valid) => {
          if (valid) {
            try {
              dialogVisible.value = false
              const { msg } = await editDbConfig(form)
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              getList()
            } catch (error) {
              console.error('保存数据库配置失败:', error)
              ElMessage.error('保存数据库配置失败')
            }
          }
        })
      }

      const queryData = () => {
        queryForm.pageNum = 1
        getList()
      }

      // 分页大小改变
      const handleSizeChange = (val) => {
        queryForm.pageSize = val
        getList()
      }

      // 当前页改变
      const handleCurrentChange = (val) => {
        queryForm.pageNum = val
        getList()
      }

      const initParams = async () => {
        const { data } = await getVqDict()
        dataBaseType.value = data.dataBaseType
      }

      onMounted(() => {
        initParams()
        getList()
      })

      return {
        loading,
        dialogVisible,
        dialogType,
        formRef,
        form,
        rules,
        queryForm,
        totalNum,
        tableData,
        dataBaseType,
        testConnectionMethod,
        handleAdd,
        handleEdit,
        handleDelete,
        handleCanvas,
        handleRelationCanvas,
        handleSubmit,
        handleSizeChange,
        handleCurrentChange,
      }
    },
  })
</script>

<template>
  <div class="db-config-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="12">
        <el-button
          v-permissions="{ permission: ['DbConfig:add'] }"
          :icon="Plus"
          type="primary"
          @click="handleAdd($event)"
        >
          新增配置
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="12">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.dbName"
              clearable
              placeholder="请输入数据库名称"
            />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Search" type="primary" @click="queryData">
              查询
            </el-button>
          </el-form-item>
        </el-form>
      </vab-query-form-right-panel>
    </vab-query-form>

    <el-table v-loading="loading" :data="tableData" border style="width: 100%">
      <el-table-column prop="dbName" label="数据库中文名称" min-width="120" />
      <el-table-column prop="schemaName" label="数据库" min-width="120" />
      <el-table-column prop="dbType" label="数据库类型" width="120">
        <template #default="{ row }">
          <el-tag>{{ row.dbType }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="dbHost" label="主机地址" min-width="120" />
      <el-table-column prop="dbPort" label="端口" width="100" />
      <el-table-column prop="username" label="用户名" min-width="120" />
      <el-table-column
        label="在线状态"
        prop="connectionStatus"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span v-if="row.connectionStatus === 1">
            <span class="vab-dot vab-dot-success"><span></span></span>
            在线
          </span>
          <span v-else>
            <span class="vab-dot vab-dot-error"><span></span></span>
            连接失败
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="lastCheckTime" label="最后检查时间" width="180" />
      <el-table-column
        prop="description"
        label="描述"
        min-width="200"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <el-button-group>
            <el-button
              type="primary"
              link
              @click="handleEdit(row)"
              title="编辑"
            >
              <vab-icon icon="edit-line" style="font-size: 20px" />
            </el-button>
            <el-button
              type="primary"
              link
              @click="handleCanvas(row)"
              title="表分组"
            >
              <vab-icon icon="layout-line" style="font-size: 20px" />
              表分组
            </el-button>
            <el-button
              type="primary"
              link
              @click="handleRelationCanvas(row)"
              title="关系画布"
            >
              <vab-icon icon="node-tree" style="font-size: 20px" />
              关系画布
            </el-button>
            <el-button
              type="danger"
              link
              @click="handleDelete(row)"
              title="删除"
            >
              <vab-icon icon="delete-bin-line" style="font-size: 20px" />
            </el-button>
            <el-button
              type="primary"
              link
              @click="testConnectionMethod(row)"
              title="测试连接"
            >
              <vab-icon icon="donut-chart-line" style="font-size: 20px" />
            </el-button>
          </el-button-group>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <el-pagination
      :current-page="queryForm.pageNum"
      layout="total, sizes, prev, pager, next, jumper"
      :page-size="queryForm.pageSize"
      :total="totalNum"
      @current-change="handleCurrentChange"
      @size-change="handleSizeChange"
    />

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? '新增配置' : '编辑配置'"
      width="900px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="150px">
        <el-form-item label="数据库中文名称" prop="dbName">
          <el-input v-model="form.dbName" placeholder="请输入数据库中文名称" />
        </el-form-item>
        <el-form-item label="默认数据库" prop="schemaName">
          <el-input v-model="form.schemaName" placeholder="请输入默认数据库" />
        </el-form-item>
        <el-form-item label="数据库类型" prop="dbType">
          <el-select v-model="form.dbType" placeholder="请选择数据库类型">
            <el-option
              v-for="item in dataBaseType"
              :key="item.code"
              :label="item.label"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="主机地址" prop="dbHost">
          <el-input v-model="form.dbHost" placeholder="请输入主机地址" />
        </el-form-item>
        <el-form-item label="端口" prop="dbPort">
          <el-input-number v-model="form.dbPort" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="连接URL" prop="jdbcUrl">
          <el-input v-model="form.jdbcUrl" placeholder="请输入JDBC连接URL" />
        </el-form-item>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入描述"
          />
        </el-form-item>
        <el-form-item label="排序" prop="orderNum">
          <el-input-number v-model="form.orderNum" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
  .db-config-container {
    padding: 20px;

    .header-actions {
      margin-bottom: 20px;
    }

    :deep(.el-pagination) {
      justify-content: flex-end;
      margin-top: 20px;
    }
  }
</style>
