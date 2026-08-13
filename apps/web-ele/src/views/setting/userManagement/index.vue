<script>
  import {
    defineAsyncComponent,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'

  import { doDelete, getList, resetPwd } from '@/api/userManagement'
  import { Delete, Plus, Search } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'UserManagement',
    components: {
      // Edit: defineAsyncComponent(() =>
      //   import('./components/UserManagementEdit')
      Edit: defineAsyncComponent(
        // () => import('./components/JgUserManagementEdit')
        () => import('./components/UserManagementEdit.vue')
      ),
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        editRef: null,
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        selectRows: '',
        queryForm: {
          pageNum: 1,
          pageSize: 10,
          userName: '',
        },
      })

      const setSelectRows = (val) => {
        state.selectRows = val
      }
      const handleEdit = (row) => {
        if (row && row.userId) {
          state.editRef.showEdit(row)
        } else {
          state.editRef.showEdit()
        }
      }
      const resetPassword = async (row) => {
        if (row && row.userId) {
          const { msg } = await resetPwd({ userId: row.userId })
          $baseMessage(msg, 'success', 'vab-hey-message-success')
        }
      }
      
      const handleDelete = (row) => {
        if (row.userId) {
          $baseConfirm('你确定要删除当前项吗', null, async () => {
            const { msg } = await doDelete({ userIds: [row.userId] })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          })
        } else {
          if (state.selectRows.length > 0) {
            const ids = state.selectRows.map((item) => item.id).join()
            $baseConfirm('你确定要删除选中项吗', null, async () => {
              const { msg } = await doDelete({ userIds: ids })
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              await fetchData()
            })
          } else {
            $baseMessage('未选中任何行', 'error', 'vab-hey-message-error')
          }
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
      const fetchData = async () => {
        state.listLoading = true
        const {
         list, total
        } = await getList(state.queryForm)
        state.list = list
        state.total = total
        state.listLoading = false
      }
      onMounted(() => {
        fetchData()
      })

      return {
        ...toRefs(state),
        setSelectRows,
        handleEdit,
        handleDelete,
        handleSizeChange,
        handleCurrentChange,
        queryData,
        fetchData,
        Delete,
        Plus,
        Search,
        resetPassword,
      }
    },
  })
</script>

<template>
  <div class="user-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="12">
        <el-button v-permissions="{ permission: ['UserManagement:add'] }" :icon="Plus" type="primary" @click="handleEdit($event)">
          添加
        </el-button>
        <el-button v-permissions="{ permission: ['UserManagement:delete'] }" :icon="Delete" type="danger" @click="handleDelete($event)">
          批量删除
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="12">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.userName"
              clearable
              placeholder="请输入用户名"
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

    <el-table
      v-loading="listLoading"
      border
      :data="list"
      @selection-change="setSelectRows"
    >
      <el-table-column align="center" show-overflow-tooltip type="selection" />
      <el-table-column align="center" label="序号" width="55">
        <template #default="{ $index }">
          {{ $index + 1 }}
        </template>
      </el-table-column>
      <el-table-column
        align="center"
        label="id"
        prop="userId"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="用户名"
        prop="userName"
        show-overflow-tooltip
      />
      <!-- <el-table-column
        align="center"
        label="昵称"
        prop="nickName"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="邮箱"
        prop="email"
        show-overflow-tooltip
      /> -->

      <el-table-column align="center" label="角色" show-overflow-tooltip>
        <template #default="{ row }">
          <el-tag v-for="(item, index) in row.roles" :key="index">
            {{ item.roleName }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        align="center"
        label="创建时间"
        prop="createTime"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="操作"
        show-overflow-tooltip
        width="300"
      >
        <template #default="{ row }">
          <el-button v-permissions="{ permission: ['UserManagement:update'] }" text type="primary" @click="handleEdit(row)">
            编辑
          </el-button>
          <el-button v-permissions="{ permission: ['UserManagement:resetPwd'] }" text type="primary" @click="resetPassword(row)">
            重置密码
          </el-button>
          <el-button v-permissions="{ permission: ['UserManagement:delete'] }" text type="primary" @click="handleDelete(row)">
            删除
          </el-button>
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
    <Edit ref="editRef" @fetch-data="fetchData" />
  </div>
</template>
