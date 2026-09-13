<script>
  import {
    defineAsyncComponent,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'

  import { doDelete, getTree } from '@/api/departmentManagement'
  import { Delete, Plus, Search, Sort } from '@element-plus/icons-vue'
// import { rowProps } from 'element-plus'

  export default defineComponent({
    name: 'DepartmentManagement',
    components: {
      Edit: defineAsyncComponent(
        () => import('./components/DepartmentManagementEdit.vue')
      ),
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        tableRef: null,
        editRef: null,
        list: [],
        listLoading: true,
        queryForm: {
          deptName: '',
        },
        expand: true,
      })

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
            const { msg } = await doDelete({ id: row.id })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          })
        }
      }
      
      const queryData = () => {
        fetchData()
      }
      const fetchData = async () => {
        state.listLoading = true
        const { data } = await getTree(state.queryForm)
        state.list = data
        state.listLoading = false
      }
      const handleExpand = () => {
        state.expand = !state.expand
        expand(state.list, state.expand)
      }
      const expand = (data, flag) => {
        data.forEach(row => {
          if(row.children && row.children.length>0){
            expand(row.children, flag)
            state.tableRef.toggleRowExpansion(row, flag)
          }
        })
      }
      onMounted(() => {
        fetchData()
      })

      return {
        ...toRefs(state),
        handleEdit,
        handleDelete,
        queryData,
        fetchData,
        Delete,
        Plus,
        Search,
        Sort,
        handleExpand,
      }
    },
  })
</script>

<template>
  <div class="department-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="12">
        <el-button v-permissions="{ permission: ['DepartmentManagement:aou'] }" :icon="Plus" type="primary" @click="handleEdit($event)">
          {{ $tr('添加') }}
        </el-button>
        <!-- <el-button :icon="Delete" type="danger" @click="handleDelete($event)">
          {{ $tr('批量删除') }}
        </el-button> -->
        <el-button :icon="Sort" type="info" @click="handleExpand($event)">
          {{ $tr('展开/折叠') }}
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="12">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.deptName"
              clearable
              :placeholder="$tr('请输入名称')"
            />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Search" type="primary" @click="queryData">
              {{ $tr('查询') }}
            </el-button>
          </el-form-item>
        </el-form>
      </vab-query-form-right-panel>
    </vab-query-form>

    <el-table
      ref="tableRef"
      v-loading="listLoading"
      border
      :data="list"
      :default-expand-all="expand"
      row-key="id"
      :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
    >
      <el-table-column :label="$tr('名称')" prop="label" show-overflow-tooltip />
      <el-table-column :label="$tr('节点Id')" prop="id" show-overflow-tooltip />
      <el-table-column :label="$tr('排序')" prop="weight" show-overflow-tooltip />
      <el-table-column :label="$tr('操作')" width="200">
        <template #default="{ row }">
          <el-button v-permissions="{ permission: ['DepartmentManagement:aou'] }" text type="primary" @click="handleEdit(row)">
            {{ $tr('编辑') }}
          </el-button>
          <el-button
            v-permissions="{ permission: ['DepartmentManagement:delete'] }"
            :disabled="!row.parentId"
            text
            type="primary"
            @click="handleDelete(row)"
          >
            {{ $tr('删除') }}
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <!--  <el-image
          class="vab-data-empty"
          :src="require('@/assets/empty_images/data_empty.png')"
        /> -->
        <el-empty class="vab-data-empty" :description="$tr('暂无数据')" />
      </template>
    </el-table>
    <Edit ref="editRef" @fetch-data="fetchData" />
  </div>
</template>
