<script>
  /**
   * 数据库连接配置：公开性、密码留空不改、会员授权分配
   * @author yanch
   */
  import { defineComponent, inject, onMounted, reactive, ref } from 'vue'
  import { useRouter } from 'vue-router'

  import { getMemberUser, searchMemberUser } from '@/api/member/memberUser'
  import { testConnection } from '@/api/visual/database'
  import {
    deleteDbConfig,
    editDbConfig,
    getDbConfigPage,
    getVqDict,
    listDbConfigUsers,
    listMemberUserGroups,
    listMemberUsersByGroup,
    replaceDbConfigUsers,
  } from '@/api/visual/vq'
  import { Plus, Search } from '@element-plus/icons-vue'
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
      const dataBaseType = ref([])
      const $baseMessage = inject('$baseMessage')

      const form = reactive({
        id: undefined,
        dbName: '',
        schemaName: '',
        dbType: '',
        dbHost: '',
        dbPort: 3306,
        jdbcUrl: '',
        username: '',
        password: '',
        description: '',
        orderNum: 0,
        isPublic: 0,
      })

      const queryForm = reactive({
        pageNum: 1,
        pageSize: 10,
        dbName: '',
      })

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
        username: [
          { required: true, message: '请输入用户名', trigger: 'blur' },
        ],
        // 新增必填；编辑留空表示不改密码
        password: [
          {
            validator: (_r, v, cb) => {
              if (dialogType.value === 'add' && !v) {
                cb(new Error('请输入密码'))
              } else {
                cb()
              }
            },
            trigger: 'blur',
          },
        ],
      }

      // ---------- 授权弹窗 ----------
      const authVisible = ref(false)
      const authSaving = ref(false)
      const authDbConfigId = ref(null)
      const authDbName = ref('')
      const memberGroups = ref([])
      const selectedGroupId = ref(null)
      const groupUsers = ref([])
      /** { memberUserId, userName, realName, canUse, canEditCanvas } */
      const grants = ref([])
      const searchKeyword = ref('')

      const getList = async () => {
        loading.value = true
        try {
          const { list, total } = await getDbConfigPage(queryForm)
          tableData.value = list
          totalNum.value = total
        } catch (error) {
          $baseMessage(
            '获取数据库配置列表失败',
            'error',
            'vab-hey-message-error',
          )
        } finally {
          loading.value = false
        }
      }

      const handleAdd = () => {
        dialogType.value = 'add'
        Object.assign(form, {
          id: undefined,
          dbName: '',
          schemaName: '',
          dbType: '',
          dbHost: '',
          dbPort: 3306,
          jdbcUrl: '',
          username: '',
          password: '',
          description: '',
          orderNum: 0,
          isPublic: 0,
        })
        dialogVisible.value = true
      }

      const handleEdit = (row) => {
        dialogType.value = 'edit'
        Object.assign(form, {
          ...row,
          // 密码不回显；留空提交则后端保留原密码
          password: '',
          isPublic: row.isPublic == null ? 0 : row.isPublic,
        })
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

      const handleCanvas = (row) => {
        router.push({ name: 'DbConfigCanvas', query: { id: row.id } })
      }

      const handleRelationCanvas = (row) => {
        router.push({
          name: 'RelationCanvas',
          query: {
            id: row.id,
            ...(row.schemaName ? { instance: row.schemaName } : {}),
          },
        })
      }

      const handleSubmit = async () => {
        if (!formRef.value) return
        await formRef.value.validate(async (valid) => {
          if (valid) {
            try {
              dialogVisible.value = false
              const payload = { ...form }
              // 编辑且密码为空：不传 password，避免误清空
              if (dialogType.value === 'edit' && !payload.password) {
                delete payload.password
              }
              const { msg } = await editDbConfig(payload)
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              getList()
            } catch (error) {
              console.error('保存数据库配置失败:', error)
              ElMessage.error('保存数据库配置失败')
            }
          }
        })
      }

      const openAuthDialog = async (row) => {
        authDbConfigId.value = row.id
        authDbName.value = row.dbName || ''
        authVisible.value = true
        selectedGroupId.value = null
        groupUsers.value = []
        searchKeyword.value = ''
        try {
          const [{ data: groups }, { data: existing }] = await Promise.all([
            listMemberUserGroups(),
            listDbConfigUsers(row.id),
          ])
          memberGroups.value = groups || []
          grants.value = (existing || []).map((g) => ({
            memberUserId: g.memberUserId,
            userName: g.userName || '',
            realName: g.realName || '',
            canUse: g.canUse == null ? 1 : g.canUse,
            canEditCanvas: g.canEditCanvas == null ? 0 : g.canEditCanvas,
          }))
          await enrichGrantNames(grants.value)
        } catch (e) {
          console.error(e)
          ElMessage.error('加载授权信息失败')
        }
      }

      /** 授权表只有会员ID时，补全用户名/姓名便于识别 */
      const enrichGrantNames = async (list) => {
        const need = (list || []).filter((g) => g.memberUserId && !g.userName)
        if (!need.length) return
        await Promise.all(
          need.map(async (g) => {
            try {
              const { data } = await getMemberUser(g.memberUserId)
              if (data) {
                g.userName = data.userName || String(g.memberUserId)
                g.realName = data.realName || ''
              }
            } catch {
              g.userName = g.userName || String(g.memberUserId)
            }
          }),
        )
      }

      const onSelectGroup = async (groupId) => {
        selectedGroupId.value = groupId
        if (!groupId) {
          groupUsers.value = []
          return
        }
        try {
          const { data } = await listMemberUsersByGroup(groupId)
          groupUsers.value = data || []
        } catch (e) {
          console.error(e)
          groupUsers.value = []
        }
      }

      const upsertGrant = (user, defaults = {}) => {
        const id = user.id || user.memberUserId
        if (!id) return
        const idx = grants.value.findIndex((g) => String(g.memberUserId) === String(id))
        const row = {
          memberUserId: id,
          userName: user.userName || user.username || String(id),
          realName: user.realName || '',
          canUse: defaults.canUse != null ? defaults.canUse : 1,
          canEditCanvas: defaults.canEditCanvas != null ? defaults.canEditCanvas : 0,
        }
        if (idx >= 0) {
          grants.value[idx] = { ...grants.value[idx], ...row }
        } else {
          grants.value.push(row)
        }
      }

      const addGroupAllUsers = () => {
        if (!groupUsers.value.length) {
          ElMessage.warning('该分组下没有会员，请先在会员管理中分配分组')
          return
        }
        for (const u of groupUsers.value) {
          upsertGrant(u)
        }
        ElMessage.success(`已勾选本组 ${groupUsers.value.length} 名用户`)
      }

      const addSingleUser = (user) => {
        upsertGrant(user)
      }

      const searchAndAddUser = async () => {
        const kw = (searchKeyword.value || '').trim()
        if (!kw) {
          ElMessage.warning('请输入用户名 / 姓名 / 手机号')
          return
        }
        try {
          const res = await searchMemberUser({ userName: kw })
          const list = res?.data || res?.list || []
          if (!list.length) {
            ElMessage.warning('未找到用户')
            return
          }
          for (const u of list) {
            upsertGrant(u)
          }
          ElMessage.success(`已加入 ${list.length} 名用户`)
        } catch (e) {
          console.error(e)
          ElMessage.error('搜索用户失败')
        }
      }

      const removeGrant = (memberUserId) => {
        grants.value = grants.value.filter(
          (g) => String(g.memberUserId) !== String(memberUserId),
        )
      }

      const saveAuth = async () => {
        if (!authDbConfigId.value) return
        authSaving.value = true
        try {
          await replaceDbConfigUsers({
            dbConfigId: authDbConfigId.value,
            grants: grants.value.map((g) => ({
              memberUserId: g.memberUserId,
              canUse: g.canUse ? 1 : 0,
              canEditCanvas: g.canEditCanvas ? 1 : 0,
            })),
          })
          ElMessage.success('授权已保存')
          authVisible.value = false
        } catch (e) {
          console.error(e)
          ElMessage.error('保存授权失败')
        } finally {
          authSaving.value = false
        }
      }

      const queryData = () => {
        queryForm.pageNum = 1
        getList()
      }

      const handleSizeChange = (val) => {
        queryForm.pageSize = val
        getList()
      }

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
        queryData,
        openAuthDialog,
        authVisible,
        authSaving,
        authDbName,
        memberGroups,
        selectedGroupId,
        groupUsers,
        grants,
        searchKeyword,
        onSelectGroup,
        addGroupAllUsers,
        addSingleUser,
        searchAndAddUser,
        removeGrant,
        saveAuth,
        Plus,
        Search,
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
            <el-button :icon="Search" type="primary" v-permissions="{ permission: ['DbConfig:list'] }" @click="queryData">
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
      <el-table-column label="公开" width="80">
        <template #default="{ row }">
          <el-tag :type="row.isPublic === 1 ? 'success' : 'info'" size="small">
            {{ row.isPublic === 1 ? '公开' : '私有' }}
          </el-tag>
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
      <el-table-column label="操作" width="380" fixed="right">
        <template #default="{ row }">
          <el-button-group>
            <el-button
              v-permissions="{ permission: ['DbConfig:update'] }"
              type="primary"
              link
              @click="handleEdit(row)"
              title="编辑"
            >
              <vab-icon icon="edit-line" style="font-size: 20px" />
            </el-button>
            <el-button
              v-permissions="{ permission: ['DbConfigUser:update'] }"
              type="primary"
              link
              @click="openAuthDialog(row)"
              title="权限分配"
            >
              权限
            </el-button>
            <el-button
              v-permissions="{ permission: ['TableGroup:list'] }"
              type="primary"
              link
              @click="handleCanvas(row)"
              title="表分组"
            >
              <vab-icon icon="layout-line" style="font-size: 20px" />
              表分组
            </el-button>
            <el-button
              v-permissions="{ permission: ['TableRelationship:info'] }"
              type="primary"
              link
              @click="handleRelationCanvas(row)"
              title="关系画布"
            >
              <vab-icon icon="node-tree" style="font-size: 20px" />
              关系画布
            </el-button>
            <el-button
              v-permissions="{ permission: ['DbConfig:delete'] }"
              type="danger"
              link
              @click="handleDelete(row)"
              title="删除"
            >
              <vab-icon icon="delete-bin-line" style="font-size: 20px" />
            </el-button>
            <el-button
              v-permissions="{ permission: ['DataBaseOperate:test'] }"
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

    <el-pagination
      :current-page="queryForm.pageNum"
      layout="total, sizes, prev, pager, next, jumper"
      :page-size="queryForm.pageSize"
      :total="totalNum"
      @current-change="handleCurrentChange"
      @size-change="handleSizeChange"
    />

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
            :placeholder="dialogType === 'edit' ? '留空则不修改密码' : '请输入密码'"
            show-password
          />
        </el-form-item>
        <el-form-item label="是否公开">
          <el-switch
            v-model="form.isPublic"
            :active-value="1"
            :inactive-value="0"
            active-text="公开库"
            inactive-text="私有库"
          />
          <div style="font-size: 12px; color: var(--el-text-color-secondary)">
            公开：登录用户可使用（默认不可改画布）；私有：仅所有者/管理员与授权用户
          </div>
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

    <!-- 权限分配：会员组批量勾选 + 授权表 -->
    <el-dialog
      v-model="authVisible"
      :title="`权限分配 — ${authDbName}`"
      width="920px"
      destroy-on-close
    >
      <div class="auth-layout">
        <div class="auth-left">
          <div class="auth-section-title">会员组</div>
          <el-select
            v-model="selectedGroupId"
            placeholder="选择会员组"
            filterable
            clearable
            style="width: 100%; margin-bottom: 8px"
            @change="onSelectGroup"
          >
            <el-option
              v-for="g in memberGroups"
              :key="g.id"
              :label="g.groupName"
              :value="g.id"
            />
          </el-select>
          <el-button
            type="primary"
            size="small"
            :disabled="!groupUsers.length"
            @click="addGroupAllUsers"
          >
            勾选本组全部用户（{{ groupUsers.length }}）
          </el-button>
          <el-table
            v-if="groupUsers.length"
            :data="groupUsers"
            border
            size="small"
            max-height="220"
            style="margin-top: 8px"
          >
            <el-table-column prop="userName" label="用户名" min-width="90" />
            <el-table-column prop="realName" label="姓名" min-width="80" />
            <el-table-column label="" width="56" align="center">
              <template #default="{ row }">
                <el-button link type="primary" @click="addSingleUser(row)">加入</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-else-if="selectedGroupId"
            description="该组暂无会员"
            :image-size="48"
          />
          <el-divider />
          <div class="auth-section-title">搜索用户加入</div>
          <el-input
            v-model="searchKeyword"
            placeholder="用户名 / 姓名 / 手机号"
            size="small"
            clearable
            @keyup.enter="searchAndAddUser"
          >
            <template #append>
              <el-button @click="searchAndAddUser">搜索</el-button>
            </template>
          </el-input>
        </div>
        <div class="auth-right">
          <div class="auth-section-title">已授权用户</div>
          <el-table :data="grants" border size="small" max-height="420">
            <el-table-column prop="userName" label="用户名" min-width="100" />
            <el-table-column prop="realName" label="姓名" min-width="90" />
            <el-table-column label="可用" width="80" align="center">
              <template #default="{ row }">
                <el-switch v-model="row.canUse" :active-value="1" :inactive-value="0" />
              </template>
            </el-table-column>
            <el-table-column label="可改画布" width="100" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canEditCanvas"
                  :active-value="1"
                  :inactive-value="0"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" align="center">
              <template #default="{ row }">
                <el-button link type="danger" @click="removeGrant(row.memberUserId)">
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="authVisible = false">取消</el-button>
        <el-button type="primary" :loading="authSaving" @click="saveAuth">保存授权</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
  .db-config-container {
    padding: 20px;

    :deep(.el-pagination) {
      justify-content: flex-end;
      margin-top: 20px;
    }
  }

  .auth-layout {
    display: flex;
    gap: 16px;
    min-height: 360px;
  }

  .auth-left {
    width: 280px;
    flex-shrink: 0;
  }

  .auth-right {
    flex: 1;
    min-width: 0;
  }

  .auth-section-title {
    margin-bottom: 8px;
    font-weight: 600;
  }
</style>
