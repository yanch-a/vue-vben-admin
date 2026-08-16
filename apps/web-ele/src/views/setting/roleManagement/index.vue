<script>
  import {
    defineAsyncComponent,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'

  import { doDelete, getList } from '@/api/roleManagement'
  import { dictConvertObj } from '@/utils/convert'
  import {
    CirclePlus,
    Delete,
    Edit as EditIcon,
    Plus,
    Search,
  } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'RoleManagement',
    components: {
      RoleManagementEditDialog: defineAsyncComponent(
        () => import('./components/RoleManagementEdit.vue')
      ),
      EditPermissions: defineAsyncComponent(
        () => import('./components/RoleManagementEditPermissions.vue')
      ),
      EditChannelPermissions: defineAsyncComponent(
        () => import('./components/RoleManagementEditChannelPermissions.vue')
      ),
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        editRef: null,
        editPermissionsRef: null,
        editChannelPermissionsRef: null,
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        selectRows: '',
        queryForm: {
          pageNum: 1,
          pageSize: 10,
          role: '',
        },
      })

      const setSelectRows = (val) => {
        state.selectRows = val
      }
      const handleEdit = (row) => {
        if (row && row.roleId) {
          state.editRef.showEdit({ id: row.roleId })
        } else {
          state.editRef.showEdit()
        }
      }
      const handleEditPermissions = (row) => {
        if (row && row.roleId) {
          state.editPermissionsRef.showEditPermissions({
            id: row.roleId,
            roleName: row.roleName,
          })
        }
      }

      const handleChannelPermissions = (row) => {
        if (row && row.roleId) {
          state.editChannelPermissionsRef.showChannelEditPermissions({
            id: row.roleId,
            roleName: row.roleName,
          })
        }
      }
      const handleDelete = (row) => {
        if (row.roleId) {
          $baseConfirm('你确定要删除当前项吗', null, async () => {
            const { msg } = await doDelete({ ids: row.roleId })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          })
        } else {
          if (state.selectRows.length > 0) {
            const ids = state.selectRows.map((item) => item.roleId).join()
            $baseConfirm('你确定要删除选中项吗', null, async () => {
              const { msg } = await doDelete({ ids })
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
        const { list, total } = await getList(state.queryForm)
        state.list = dictConvertObj(list)
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
        EditIcon,
        CirclePlus,
        handleEditPermissions,
        handleChannelPermissions,
      }
    },
  })
</script>

<template>
  <div class="role-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="12">
        <el-button :icon="Plus" type="primary" @click="handleEdit($event)">
          添加
        </el-button>
        <el-button :icon="Delete" type="danger" @click="handleDelete($event)">
          批量删除
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="12">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.roleKey"
              clearable
              placeholder="请输入角色编码"
            />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.roleName"
              clearable
              placeholder="请输入角色名称"
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
        prop="roleId"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="角色名称"
        prop="roleName"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="角色编码"
        prop="roleKey"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="排序"
        prop="roleSort"
        show-overflow-tooltip
      />
      <el-table-column align="center" label="角色状态" prop="status" />
      <el-table-column align="center" label="创建时间" prop="createTime" />
      <el-table-column
        align="center"
        label="操作"
        show-overflow-tooltip
        width="300"
      >
        <template #default="{ row }">
          <el-button
            v-permissions="{ permission: ['RoleManagement:aou'] }"
            :icon="EditIcon"
            text
            type="primary"
            @click="handleEdit(row)"
            title="编辑"
          />
          <el-button
            v-permissions="{ permission: ['RoleManagement:delete'] }"
            :icon="Delete"
            text
            type="primary"
            @click="handleDelete(row)"
            title="删除"
          />
          <el-button
            v-permissions="{ permission: ['RoleManagement:updateRolePerm'] }"
            :icon="Plus"
            text
            type="primary"
            @click="handleEditPermissions(row)"
            title="分配菜单权限"
          />
          <el-button
            v-permissions="{
              permission: ['RoleManagement:updateChannelRolePerm'],
            }"
            :icon="CirclePlus"
            text
            type="primary"
            @click="handleChannelPermissions(row)"
          >
            栏目权限
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <!--  <el-image
          class="vab-data-empty"
          :src="require('@/assets/empty_images/data_empty.png')"
        /> -->
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
    <RoleManagementEditDialog ref="editRef" @fetch-data="fetchData" />
    <EditPermissions ref="editPermissionsRef" @fetch-data="fetchData" />
    <EditChannelPermissions
      ref="editChannelPermissionsRef"
      @fetch-data="fetchData"
    />
  </div>
</template>
