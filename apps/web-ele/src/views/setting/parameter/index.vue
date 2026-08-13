<script>
  import {
    defineAsyncComponent,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'

  import { doDelete, getPage } from '@/api/system/parameterApi'
  import { Delete, Edit as EditIcon, Plus, Search } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'ParameterManage',
    components: {
      Edit: defineAsyncComponent(() =>
        import('./ParameterDialog.vue')
      ),
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')
      const state = reactive({
        list: [],
        listLoading: true,
        editRef: null,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        selectRows: '',
        queryForm: {
          pageNum: 1,
          pageSize: 10,
        },
      })

      const setSelectRows = (val) => {
        state.selectRows = val
      }

      const handleEdit = (row) => {
        if (row.id) {
          state.editRef.showEdit(row)
        } else {
          state.editRef.showEdit()
        }
      }

      const handleDelete = (row) => {
        if (row.id) {
          $baseConfirm('你确定要删除当前项吗', null, async () => {
            const { msg } = await doDelete({ ids: [row.id] })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          })
        } else {
          if (state.selectRows.length > 0) {
            const ids = state.selectRows.map((item) => item.id).join()
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
        const {
         list, total
        } = await getPage(state.queryForm)
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
        Plus,
        Delete,
        EditIcon,
        Search,
      }
    },
  })
</script>

<template>
  <div class="config-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="12">
        <el-button v-permissions="{ permission: ['Parameter:add'] }" :icon="Plus" type="primary" @click="handleEdit($event)">
          新增
        </el-button>
        <el-button v-permissions="{ permission: ['Parameter:batchDel'] }" :icon="Delete" type="danger" @click="handleDelete($event)">
          批量删除
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="12">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input v-model.trim="queryForm.title" clearable placeholder="请输入单行文本标题" />
          </el-form-item>
          <el-form-item>
            <el-input v-model.trim="queryForm.code" clearable placeholder="请输入编码" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Search" type="primary" @click="queryData">
              查询
            </el-button>
          </el-form-item>
        </el-form>
      </vab-query-form-right-panel>
    </vab-query-form>
    <el-table v-loading="listLoading" border :data="list" @selection-change="setSelectRows">
      <el-table-column align="center" type="selection" />
      <el-table-column align="center" label="序号" width="55">
        <template #default="{ $index }">
          {{ $index + 1 }}
        </template>
      </el-table-column>
      <el-table-column align="center" label="主键" prop="id" width="80" />
      <el-table-column align="center" label="标题" prop="title" show-overflow-tooltip>
        <template #default="{ row }">
          <el-button key="primary" link type="primary" @click="handleEdit(row)">{{ row.title }}</el-button>
        </template>
      </el-table-column>
      <el-table-column align="center" label="编码" prop="code" show-overflow-tooltip />
      <el-table-column align="center" label="值1" prop="value1" show-overflow-tooltip />
      <el-table-column align="center" label="排序" prop="orderNum" show-overflow-tooltip />
      <el-table-column align="center" label="创建时间" prop="createTime" show-overflow-tooltip />
      <el-table-column align="center" label="操作" width="200">
        <template #default="{ row }">
          <el-button v-permissions="{ permission: ['Parameter:edit'] }" circle :icon="EditIcon" text type="primary" @click="handleEdit(row)">
            编辑
          </el-button>
          <el-button v-permissions="{ permission: ['Parameter:delete'] }" circle :icon="Delete" text type="danger" @click="handleDelete(row)">
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
