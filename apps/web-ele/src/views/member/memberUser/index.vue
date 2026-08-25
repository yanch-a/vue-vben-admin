<script>
  import {
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'
  import { useRouter } from 'vue-router'

  import { getMemberLevelList } from '@/api/member/memberLevelApi'
  import { getMemberUserGroupList } from '@/api/member/memberUserGroup'
  import { doDelete, getPage } from '@/api/member/memberUserApi'
  import { dictConvertObj } from '@/utils/convert'
  import { Delete, Edit as EditIcon, Plus, Search } from '@element-plus/icons-vue'
  export default defineComponent({
    name: 'MemberUserManage',
    components: {},
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')
      const router = useRouter()
      const state = reactive({
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        selectRows: '',
        userLevelOptions: [],
        userGroupOptions: [],
        queryForm: {
          pageNum: 1,
          pageSize: 10,
          memberLevelId: undefined,
          userGroup: undefined,
        },
      })

      const setSelectRows = (val) => {
        state.selectRows = val
      }

      const handleEdit = (row) => {
        if (row && row.id) {
          // 编辑
          router.push({
            path: '/memberUser/detail',
            query: {
              id: row.id,
              title: '编辑-会员管理',
              timestamp: new Date().getTime(),
            },
          })
        } else {
          // 新增
          router.push({
            path: '/memberUser/detail',
            query: {
              title: '新增-会员管理',
              timestamp: new Date().getTime(),
            },
          })
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
        const { list, total } = await getPage(state.queryForm)
        state.list = dictConvertObj(list, 'common', ['sex'])
        state.total = total
        state.listLoading = false
      }
      const loadUserLevelOptions = async () => {
        const { data } = await getMemberLevelList({})
        state.userLevelOptions = data || []
      }
      const loadUserGroupOptions = async () => {
        const { data } = await getMemberUserGroupList({})
        state.userGroupOptions = data || []
      }
      const groupNameOf = (userGroup) => {
        if (userGroup == null || userGroup === '') return '-'
        const g = state.userGroupOptions.find(
          (item) => String(item.id) === String(userGroup),
        )
        return g ? g.groupName : userGroup
      }
      onMounted(() => {
        loadUserLevelOptions()
        loadUserGroupOptions()
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
        groupNameOf,
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
      <vab-query-form-left-panel :span="6">
        <el-button
          v-permissions="{ permission: ['MemberUser:add'] }"
          :icon="Plus"
          type="primary"
          @click="handleEdit($event)"
        >
          新增
        </el-button>
        <el-button
          v-permissions="{ permission: ['MemberUser:batchDel'] }"
          :icon="Delete"
          type="danger"
          @click="handleDelete($event)"
        >
          批量删除
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="16">
        <el-form inline :model="queryForm" @submit.prevent>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.phoneNumber"
              clearable
              placeholder="请输入手机号"
            />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.userName"
              clearable
              placeholder="请输入用户名"
            />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model.trim="queryForm.realName"
              clearable
              placeholder="请输入真实名称"
            />
          </el-form-item>

          <el-form-item>
            <el-select
              v-model="queryForm.memberLevelId"
              clearable
              placeholder="请选择会员等级"
              style="width: 160px"
            >
              <el-option
                v-for="item in userLevelOptions"
                :key="item.id"
                :label="item.levelName"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select
              v-model="queryForm.userGroup"
              clearable
              placeholder="请选择会员分组"
              style="width: 160px"
            >
              <el-option
                v-for="item in userGroupOptions"
                :key="item.id"
                :label="item.groupName"
                :value="item.id"
              />
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
      @selection-change="setSelectRows"
    >
      <el-table-column align="center" type="selection" />
      <el-table-column align="center" label="会员ID" prop="id" width="80" />
      <el-table-column
        align="center"
        label="用户名"
        prop="userName"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-button key="primary" link type="primary" @click="handleEdit(row)">
            {{ row.userName }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column align="center" label="真实名称" prop="realName" />
      <el-table-column
        align="center"
        label="手机号"
        prop="phoneNumber"
        show-overflow-tooltip
      />
      <el-table-column
        align="center"
        label="会员等级"
        prop="memberLevel.levelName"
      />
      <el-table-column align="center" label="会员分组" min-width="120">
        <template #default="{ row }">
          {{ groupNameOf(row.userGroup) }}
        </template>
      </el-table-column>
      <el-table-column align="center" label="性别" prop="sex" />
      <el-table-column
        align="center"
        label="创建时间"
        prop="createTime"
        show-overflow-tooltip
      />
      <el-table-column align="center" label="操作" width="200">
        <template #default="{ row }">
          <el-button
            v-permissions="{ permission: ['MemberUser:edit'] }"
            circle
            :icon="EditIcon"
            text
            type="primary"
            @click="handleEdit(row)"
          />
          <el-button
            v-permissions="{ permission: ['MemberUser:delete'] }"
            circle
            :icon="Delete"
            text
            type="danger"
            @click="handleDelete(row)"
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
