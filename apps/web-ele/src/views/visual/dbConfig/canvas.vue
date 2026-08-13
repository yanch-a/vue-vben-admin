<script>
import { computed, defineComponent, inject, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getInstances, getTableDDL, getTablesWithColumns, testConnection } from '@/api/visual/database'
import { deleteTableGroup, editTableGroup, getGroupTablesWithColumns, getTableGroupList, saveGroupTables2DB } from '@/api/visual/vq'
import { backToListPage } from '@/utils/route-back'
import { ElMessage, ElMessageBox } from 'element-plus'

export default defineComponent({
  name: 'DbConfigCanvas',
  setup() {
    const $baseMessage = inject('$baseMessage')
    const route = useRoute()
    const router = useRouter()
    const loading = ref(false)
    const dbSearchKeyword = ref('')
    const searchKeyword = ref('')
    const dbTree = ref(null)
    const groupTree = ref(null)
    const tableTreeRef = ref(null)
    const groupFormRef = ref(null)
    // 默认展示分组
    const leftActiveTab = ref('groups')
    const groupContentTab = ref('groupTables')
    
    // 选中的分组
    const selectedGroup = ref(null)
    const groupSelectedTables = ref([])
    const groupSelectedColumns = ref([])
    // 选中的实例
    const selectedInstance = ref(null)

    // 对话框控制
    const groupDialogVisible = ref(false)
    const groupDialogType = ref('add')
    const ddlDialogVisible = ref(false)

    // 数据库树配置
    const dbTreeProps = {
      label: 'instanceName',
      children: 'instances'
    }
    
    // 分组树配置
    const groupTreeProps = {
      label: 'groupName',
      children: 'children'
    }
    
    // 数据库列表数据
    const dbList = ref([])
    
    // 表列表数据
    const tableList = ref([])
    
    // 选中的表和字段
    const selectedTables = ref([])
    const selectedColumns = ref([])
    
    // 转换表和字段数据为树形结构
    const transformedTables = computed(() => {
      const result = []
      const keyword = searchKeyword.value.toLowerCase()
      
      for (const table of tableList.value) {
        // 如果有搜索关键词，进行过滤
        if (keyword && 
            !table.tableName.toLowerCase().includes(keyword) && 
            !table.displayName?.toLowerCase().includes(keyword)) {
          continue
        }
        
        // 构建表节点
        const tableNode = {
          id: table.id,
          name: table.tableName,
          comment: table.displayName || '',
          isTable: true,
          instanceName: table.schemaName,
          children: []
        }
        
        // 添加字段子节点
        if (table.columns) {
          for (const column of table.columns) {
            tableNode.children.push({
              id: column.id,
              name: column.fieldName,
              comment: column.displayName || '',
              isTable: false,
              tableId: table.id,
              columnId: column.id,
              dataType: column.dataType,
              isPrimary: column.isPrimary,
              isNullable: column.isNullable
            })
          }
        }
        
        result.push(tableNode)
      }
      
      return result
    })
    
    // 是否有选中的项
    const hasSelectedItems = computed(() => {
      return selectedGroup.value != null;
    })
    
    // 判断是否有选中可添加的表或字段
    const hasSelectedItemsToAdd = computed(() => {
      return selectgroup.value.length > 0 || groupSelectedColumns.value.length > 0
    })
    
    // 过滤数据库列表
    const filteredDbList = computed(() => {
      if (!dbSearchKeyword.value) return dbList.value
      
      const keyword = dbSearchKeyword.value.toLowerCase()
      // 深拷贝并过滤数据
      return dbList.value.map(instance => {
        // 如果实例名称匹配关键词，保留整个实例
        if (instance.instanceName.toLowerCase().includes(keyword)) {
          return JSON.parse(JSON.stringify(instance))
        }
        
        // 否则，只保留匹配的表
        const filteredTables = (instance.tables || []).filter(table => 
          table.tableName.toLowerCase().includes(keyword)
        )
        
        // 如果有匹配的表，返回包含匹配表的实例
        if (filteredTables.length > 0) {
          return {
            ...instance,
            tables: filteredTables
          }
        }
        
        // 如果没有匹配的表，不返回此实例
        return null
      }).filter(Boolean) // 删除空值
    })
    
    // 分组列表数据
    const groupList = ref([])
    
    // 分组表单数据
    const groupForm = reactive({
      id: undefined,
      groupName: '',
      schemaName: '',
      description: '',
      orderNum: 0
    })
    
    // 分组表单校验规则
    const groupRules = {
      groupName: [{ required: true, message: '请输入分组名称', trigger: 'blur' }],
      schemaName: [{ required: true, message: '请选择所属数据库', trigger: 'change' }]
    }

    // 可选数据库实例列表
    const instanceOptions = computed(() => {
      const root = dbList.value?.[0]
      return root?.instances || []
    })
    
    // 当前DDL
    const currentDDL = ref('')
    
    // 处理表和字段的选择
    const handleTreeCheck = (data, checked) => {
      if (data.isTable) {
        // 处理表选择
        if (checked) {
          // 选中表时，同时选中所有字段
          selectedTables.value.push(data)
          
          // 自动选中该表下所有字段
          if (data.children && data.children.length > 0) {
            // 在UI上选中所有子节点
            nextTick(() => {
              data.children.forEach(child => {
                tableTreeRef.value.setChecked(child.id, true, false)
                // 添加到已选字段中
                const columnInfo = {
                  id: child.columnId,
                  tableId: child.tableId || data.id,
                  tableName: data.name,
                  columnName: child.name,
                  displayName: child.comment || '',
                  dataType: child.dataType,
                  isPrimary: child.isPrimary,
                  isNullable: child.isNullable
                }
                
                // 避免重复添加
                if (!selectedColumns.value.some(c => c.id === columnInfo.id && c.tableId === columnInfo.tableId)) {
                  selectedColumns.value.push(columnInfo)
                }
              })
            })
          }
        } else {
          // 取消选择表时，同时取消所有字段
          selectedTables.value = selectedTables.value.filter(t => t.id !== data.id)
          
          // 在UI上取消选中所有子节点
          if (data.children && data.children.length > 0) {
            nextTick(() => {
              data.children.forEach(child => {
                tableTreeRef.value.setChecked(child.id, false, false)
              })
              
              // 从已选字段中移除
              selectedColumns.value = selectedColumns.value.filter(c => c.tableId !== data.id)
            })
          }
        }
      } else {
        // 处理字段选择
        const columnInfo = {
          id: data.columnId,
          tableId: data.tableId,
          tableName: tableList.value.find(t => t.id === data.tableId)?.tableName || '',
          columnName: data.name,
          displayName: data.comment || ''
        }
        
        if (checked) {
          selectedColumns.value.push(columnInfo)
        } else {
          selectedColumns.value = selectedColumns.value.filter(c => 
            !(c.id === columnInfo.id && c.tableId === columnInfo.tableId)
          )
        }
      }
    }
    
    // 获取数据库列表
    const getDbList = async () => {
      try {
        // 调用后端API获取数据库实例
        const { data } = await getInstances(route.query.id)
        dbList.value = data
      } catch (error) {
        console.error('获取数据库列表失败:', error)
        ElMessage.error('获取数据库列表失败')
      }
    }
    
    // 获取分组列表
    const getGroupList = async () => {
      try {
        // 调用后端API获取分组
        const { data } = await getTableGroupList({dbConfigId: route.query.id})
        groupList.value = data
      } catch (error) {
        console.error('获取分组列表失败:', error)
        ElMessage.error('获取分组列表失败')
      }
    }
    
    // 点击数据库节点（手动浏览时，若与当前分组库不一致则给出提示）
    const handleDbClick = async (data) => {
      selectedInstance.value = data
      
      nextTick(() => {
        if (dbTree.value) {
          dbTree.value.setCurrentKey(data.instanceName, true)
        }
      })

      if (
        selectedGroup.value?.schemaName &&
        data.instanceName &&
        data.instanceName !== selectedGroup.value.schemaName
      ) {
        ElMessage.info(
          `当前分组绑定【${selectedGroup.value.schemaName}】，浏览【${data.instanceName}】时不能直接添加到该分组`
        )
      }
      
      if (data.tables) {
        tableList.value = data.tables
        loading.value = false
      } else {
        loading.value = true
        await getTablesWithColumns(route.query.id, data.instanceName).then(res => {
          tableList.value = res.data || []
          for (let i = 0; i < dbList.value.length; i++) {
            const tables = dbList.value[i].instances
            for (let j = 0; j < tables.length; j++) {
              const table = tables[j]
              if (table.instanceName === data.instanceName) {
                table.tables = tableList.value
                break
              }
            }
          }
        }).catch(error => {
          console.error('获取表列表失败:', error)
          ElMessage.error('获取表列表失败')
        }).finally(() => {
          loading.value = false
        })
      }
    }
    
    // 全选表
    const handleSelectAll = () => {
      if (tableTreeRef.value) {
        // 先选中所有表
        const tableIds = transformedTables.value.map(table => table.id)
        tableTreeRef.value.setCheckedKeys(tableIds, false)
        
        // 更新选中的表
        selectedTables.value = [...transformedTables.value]
        selectedColumns.value = []
        
        // 再选中所有字段
        nextTick(() => {
          transformedTables.value.forEach(table => {
            if (table.children && table.children.length > 0) {
              table.children.forEach(child => {
                tableTreeRef.value.setChecked(child.id, true, false)
                // 添加字段到选中列表
                const columnInfo = {
                  id: child.columnId,
                  tableId: child.tableId || table.id,
                  tableName: table.name,
                  columnName: child.name,
                  displayName: child.comment || '',
                  dataType: child.dataType,
                  isPrimary: child.isPrimary,
                  isNullable: child.isNullable
                }
                selectedColumns.value.push(columnInfo)
              })
            }
          })
        })
      }
    }
    
    // 取消全选表
    const handleUnselectAll = () => {
      if (tableTreeRef.value) {
        tableTreeRef.value.setCheckedKeys([], false)
      }
      selectedTables.value = []
      selectedColumns.value = []
    }
    
    // 点击分组节点：自动切到该分组绑定的数据库实例
    const handleGroupNodeClick = async (data) => {
      if (data.id == selectedGroup.value?.id) {
        return
      }
      selectedGroup.value = data
      groupSelectedTables.value = []
      selectedTables.value = []
      selectedColumns.value = []

      if (!data.schemaName) {
        ElMessage.warning('该分组未绑定数据库，请重新创建分组')
        return
      }

      // 切换到分组所属库
      const instances = dbList.value?.[0]?.instances || []
      const matched = instances.filter(it => it.instanceName === data.schemaName)
      if (matched.length > 0) {
        await handleDbClick(matched[0])
        nextTick(() => {
          if (dbTree.value) {
            try {
              dbTree.value.setCurrentKey(data.schemaName, true)
            } catch (error) {
              console.warn('设置数据库树高亮失败:', error)
            }
          }
        })
      } else {
        ElMessage.warning(`未找到分组所属数据库实例：${data.schemaName}`)
        tableList.value = []
      }

      // 加载分组已勾选的表字段
      getGroupTablesWithColumns(data.id).then(res => {
        groupSelectedTables.value = res.data || []
        selectedTables.value = groupSelectedTables.value.map(t => ({
          id: t.sourceTableId,
          tableName: t.tableName,
          displayName: t.displayName,
          instanceName: t.schemaName,
          alias: t.alias
        }))

        selectedColumns.value = groupSelectedTables.value.map(t => t.columns || []).flatMap(cols => cols.map(c => ({
          id: c.sourceFieldId,
          columnName: c.fieldName,
          displayName: c.displayName,
          tableId: c.sourceTableId,
          dataType: c.dataType,
          isPrimary: c.isPrimary,
          isNullable: c.isNullable
        })))

        nextTick(() => {
          if (!tableTreeRef.value) return
          tableTreeRef.value.setCheckedKeys([], false)
          for (const table of selectedTables.value) {
            tableTreeRef.value.setChecked(table.id, true, false)
          }
          for (const column of selectedColumns.value) {
            tableTreeRef.value.setChecked(column.id, true, false)
          }
        })
      })
    }
    
    // 点击分组中的表
    const handleGroupTableClick = (table) => {
      groupContentTab.value = 'groupColumns'
      // 仅显示该表的字段
      groupSelectedColumns.value = (selectedGroup.value.columns || [])
        .filter(col => col.tableId === table.id)
    }
    
    // 从分组中移除项（表或字段）
    const handleRemoveFromGroup = (data, node) => {
      const isTable = !node.parent || node.parent.level === 0
      
      if (isTable) {
        // 移除表
        ElMessageBox.confirm(`确认从 ${selectedGroup.value.groupName} 分组中移除 ${data.tableName} 表吗？`, '提示', {
          type: 'warning'
        }).then(async () => {
          try {
            // TODO: 调用后端API移除表
            // await removeTableFromGroup(selectedGroup.value.id, data.id)
            
            // 更新本地数据
            const index = groupSelectedTables.value.findIndex(t => t.sourceTableId === data.sourceTableId)
            if (index > -1) {
              groupSelectedTables.value.splice(index, 1)
            }
            
            // 同步取消右侧表的选中状态
            if (tableTreeRef.value) {
              tableTreeRef.value.setChecked(data.sourceTableId, false)
            }
            
            // 更新选中表的数据
            selectedTables.value = selectedTables.value.filter(t => t.id !== data.sourceTableId)
            // 更新选中的列
            selectedColumns.value = selectedColumns.value.filter(c => c.tableId !== data.sourceTableId)
            ElMessage.success('移除成功')
          } catch (error) {
            console.error('移除表失败:', error)
            ElMessage.error('移除表失败')
          }
        })
      } else {
        // 移除字段
        ElMessageBox.confirm(`确认从 ${selectedGroup.value.groupName} 分组中移除此字段吗？`, '提示', {
          type: 'warning'
        }).then(async () => {
          try {
            // 找到父表
            const parentTable = groupSelectedTables.value.find(t => t.sourceTableId === data.sourceTableId)
            if (parentTable && parentTable.columns) {
              // 从父表的children中移除
              const childIndex = parentTable.columns.findIndex(c => c.sourceFieldId === data.sourceFieldId)
              if (childIndex > -1) {
                parentTable.columns.splice(childIndex, 1)
              }
              
              // 同步取消右侧字段的选中状态
              if (tableTreeRef.value) {
                tableTreeRef.value.setChecked(data.sourceFieldId, false)
              }
              
              // 更新选中字段的数据
              selectedColumns.value = selectedColumns.value.filter(c => 
                !(c.id === data.sourceFieldId && c.tableId === data.sourceTableId)
              )
            }
            
            ElMessage.success('移除成功')
          } catch (error) {
            console.error('移除字段失败:', error)
            ElMessage.error('移除字段失败')
          }
        })
      }
    }
    
    // 新增分组
    const handleAddGroup = () => {
      groupDialogType.value = 'add'
      Object.assign(groupForm, {
        id: undefined,
        groupName: '',
        schemaName: selectedInstance.value?.instanceName || '',
        description: '',
        orderNum: 0
      })
      groupDialogVisible.value = true
    }
    
    // 编辑分组（所属库不可改）
    const handleEditGroup = (row) => {
      groupDialogType.value = 'edit'
      Object.assign(groupForm, {
        id: row.id,
        groupName: row.groupName,
        schemaName: row.schemaName,
        description: row.description,
        orderNum: row.orderNum
      })
      groupDialogVisible.value = true
    }
    
    // 删除分组
    const handleDeleteGroup = (row) => {
      ElMessageBox.confirm('确认删除该分组吗？', '提示', {
        type: 'warning'
      }).then(async () => {
        try {
          // 调用后端API删除分组数据
          await deleteTableGroup({ids: row.id})
          ElMessage.success('删除成功')
          getGroupList()
          
          // 如果删除的是当前选中的分组，清空选择
          if (selectedGroup.value && selectedGroup.value.id === row.id) {
            selectedGroup.value = null
            groupSelectedTables.value = []
            groupSelectedColumns.value = []
          }
        } catch (error) {
          console.error('删除分组失败:', error)
          ElMessage.error('删除分组失败')
        }
      })
    }
    
    // 提交分组表单
    const handleGroupSubmit = async () => {
      if (!groupFormRef.value) return
      
      await groupFormRef.value.validate(async (valid) => {
        if (valid) {
          try {
            if (groupDialogType.value === 'add') {
              await editTableGroup({
                groupName: groupForm.groupName,
                schemaName: groupForm.schemaName,
                description: groupForm.description,
                orderNum: groupForm.orderNum,
                dbConfigId: route.query.id
              })
            } else {
              // 编辑时不提交 schemaName / dbConfigId 变更（后端也会强制保留原值）
              await editTableGroup({
                id: groupForm.id,
                groupName: groupForm.groupName,
                description: groupForm.description,
                orderNum: groupForm.orderNum
              })
            }
            ElMessage.success(groupDialogType.value === 'add' ? '新增成功' : '更新成功')
            groupDialogVisible.value = false
            getGroupList()
          } catch (error) {
            console.error('保存分组失败:', error)
            ElMessage.error(error?.msg || error?.message || '保存分组失败')
          }
        }
      })
    }
    
    // 刷新表列表
    const handleRefresh = () => {
      const currentNode = dbTree.value?.getCurrentNode?.() || selectedInstance.value
      if (currentNode && currentNode.instanceName) {
        // 清空缓存强制重新拉取
        currentNode.tables = null
        handleDbClick(currentNode)
      } else if (selectedGroup.value?.schemaName) {
        const instances = dbList.value?.[0]?.instances || []
        const matched = instances.find(it => it.instanceName === selectedGroup.value.schemaName)
        if (matched) {
          matched.tables = null
          handleDbClick(matched)
        } else {
          ElMessage.warning('请先选择一个数据库')
        }
      } else {
        ElMessage.warning('请先选择一个数据库或分组')
      }
    }
    
    // 返回上一页
    const handleBack = async () => {
      await backToListPage(route, router, {
        listRouteName: 'DbConfig',
        fallbackPath: '/visual/dbConfig',
      })
    }
    
    // 直接添加到当前选中的分组（仅允许分组绑定库中的表）
    const handleDirectAddToGroup = () => {
      if (!selectedGroup.value) {
        ElMessage.warning('请先在左侧选择一个分组')
        leftActiveTab.value = 'groups'
        return
      }
      if (!selectedGroup.value.schemaName) {
        ElMessage.warning('该分组未绑定数据库，请重新创建分组')
        return
      }

      const currentSchema = selectedInstance.value?.instanceName
      if (currentSchema && currentSchema !== selectedGroup.value.schemaName) {
        ElMessage.warning(`分组【${selectedGroup.value.groupName}】仅允许添加数据库【${selectedGroup.value.schemaName}】中的表，当前浏览的是【${currentSchema}】`)
        return
      }

      const hasSelectedTables = selectedTables.value.length > 0
      const hasSelectedColumns = selectedColumns.value.length > 0
      
      if (!hasSelectedTables && !hasSelectedColumns) {
        groupSelectedTables.value = []
        return
      }

      const tablesToAdd = []
      groupSelectedTables.value = []
      let count = 0
      for (const table of selectedTables.value) {
        const tableSchema = table.instanceName || selectedGroup.value.schemaName
        if (tableSchema && tableSchema !== selectedGroup.value.schemaName) {
          ElMessage.warning(`表【${table.name}】属于【${tableSchema}】，不能加入绑定【${selectedGroup.value.schemaName}】的分组`)
          return
        }
        const tableData = {
          sourceTableId: table.id,
          dbConfigId: route.query.id,
          tableName: table.name,
          schemaName: selectedGroup.value.schemaName,
          displayName: table.comment,
          orderNum: count++,
          columns: []
        }
        const selectedColumnsForTable = selectedColumns.value.filter(c => c.tableId === table.id)
        if (selectedColumnsForTable.length > 0) {
          let countField = 0
          selectedColumnsForTable.forEach(column => {
            tableData.columns.push({
              sourceFieldId: column.id,
              sourceTableId: table.id,
              fieldName: column.columnName,
              displayName: column.displayName || '',
              dataType: column.dataType,
              isPrimary: column.isPrimary,
              isNullable: column.isNullable,
              orderNum: countField++
            })
          })
        }
        tablesToAdd.push(tableData)
      }
      groupSelectedTables.value = tablesToAdd
      ElMessage.success(`已成功添加到分组 ${selectedGroup.value.groupName}，请保存分组到数据库`)
    }

    // 保存分组到数据库
    const saveGroup2DB = () => {
      if (!selectedGroup.value) {
        ElMessage.warning('请先选择分组')
        return
      }
      const mismatch = groupSelectedTables.value.find(
        t => t.schemaName && t.schemaName !== selectedGroup.value.schemaName
      )
      if (mismatch) {
        ElMessage.warning(`分组仅允许【${selectedGroup.value.schemaName}】中的表`)
        return
      }
      saveGroupTables2DB(selectedGroup.value.id, groupSelectedTables.value).then(() => {
        ElMessage.success('保存成功')
      }).catch(error => {
        console.error('保存失败:', error)
        ElMessage.error(error?.msg || error?.message || '保存失败')
      })
    }
    
    // 查看DDL
    const handleViewDDL = async (row) => {
      try {
        // 调用后端API获取DDL
        const { data } = await getTableDDL(route.query.id, row.instanceName, row.name)
        currentDDL.value = data.ddl

        ddlDialogVisible.value = true
      } catch (error) {
        console.error('获取表DDL失败:', error)
        ElMessage.error('获取表DDL失败')
      }
    }
    
    // 复制DDL
    const handleCopyDDL = () => {
      navigator.clipboard.writeText(currentDDL.value).then(() => {
        ElMessage.success('复制成功')
      }).catch(() => {
        ElMessage.error('复制失败')
      })
    }

    // 测试连接
    const handleTestConnection = async () => {
      const { data } = await testConnection(route.query.id)
      if (data.success) {
        ElMessage.success('连接成功')
      } else {
        ElMessage.error('连接失败')
      }
    }
    
    // 切换操作提示的可见性
    const tipVisible = ref(localStorage.getItem('dbCanvasTipVisible') !== 'false')
    const toggleTipVisible = () => {
      tipVisible.value = !tipVisible.value
      localStorage.setItem('dbCanvasTipVisible', tipVisible.value)
    }

    onMounted(() => {
      getDbList()
      getGroupList()
    })
    
    return {
      loading,
      dbSearchKeyword,
      searchKeyword,
      dbTree,
      groupTree,
      tableTreeRef,
      groupFormRef,
      leftActiveTab,
      groupContentTab,
      selectedGroup,
      groupSelectedTables,
      groupSelectedColumns,
      dbTreeProps,
      groupTreeProps,
      dbList,
      filteredDbList,
      tableList,
      transformedTables,
      selectedTables,
      selectedColumns,
      hasSelectedItems,
      hasSelectedItemsToAdd,
      groupList,
      instanceOptions,
      groupDialogVisible,
      groupDialogType,
      groupForm,
      groupRules,
      ddlDialogVisible,
      currentDDL,
      selectedInstance,
      handleDbClick,
      handleTreeCheck,
      handleGroupNodeClick,
      handleGroupTableClick,
      handleRemoveFromGroup,
      handleSelectAll,
      handleUnselectAll,
      handleAddGroup,
      handleEditGroup,
      handleDeleteGroup,
      handleGroupSubmit,
      handleRefresh,
      handleBack,
      handleDirectAddToGroup,
      handleViewDDL,
      handleCopyDDL,
      handleTestConnection,
      saveGroup2DB,
      tipVisible,
      toggleTipVisible
    }
  }
})
</script>

<template>
  <div class="db-canvas-container">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="left">
        <el-button-group>
          <el-button type="primary" @click="handleTestConnection">
            <vab-icon icon="donut-chart-line" />
            测试连接
          </el-button>
          <el-button type="primary" @click="handleRefresh">
            <vab-icon icon="refresh-line" />
            刷新表
          </el-button>
        </el-button-group>
      </div>
      <div class="right">
        <el-button @click="handleBack">
          <vab-icon icon="arrow-left-line" />
          返回
        </el-button>
      </div>
    </div>

    <!-- 主体内容区 -->
    <div class="main-content">
      <!-- 左侧：默认展示当前连接下的分组 -->
      <div class="left-panel">
        <el-card class="box-card el-card-padding-0">
          <el-tabs v-model="leftActiveTab" tab-position="top" class="left-tabs">
            <!-- 分组管理（默认） -->
            <el-tab-pane label="分组" name="groups">
              <div class="group-container">
                <div class="tab-content" style="height: 400px;">
                  <div class="card-header">
                    <el-button type="primary" link @click="handleAddGroup">
                      <vab-icon icon="add-line" />
                      新增分组
                    </el-button>
                    <el-tooltip
                      effect="dark"
                      content="每个分组绑定一个数据库实例，创建后不可更改；切换分组前请先保存"
                      placement="top"
                    >
                      <vab-icon icon="information-line" class="info-icon" />
                    </el-tooltip>
                  </div>
                  <el-alert
                    title="先选分组 → 自动切到所属库 → 勾选表字段 → 添加到分组并保存"
                    type="info"
                    :closable="false"
                    show-icon
                    style="margin-bottom: 10px;"
                  />
                  <div class="tab-body group-tree-body">
                    <el-tree
                      ref="groupTree"
                      :data="groupList"
                      :props="groupTreeProps"
                      node-key="id"
                      highlight-current
                      @node-click="handleGroupNodeClick"
                    >
                      <template #default="{ node, data }">
                        <div class="custom-tree-node">
                          <span class="group-label">
                            <vab-icon icon="folder-line" />
                            <span class="group-name">{{ node.label }}</span>
                            <el-tag v-if="data.schemaName" size="small" type="info" class="schema-tag">
                              {{ data.schemaName }}
                            </el-tag>
                          </span>
                          <span class="actions">
                            <el-button link @click.stop="handleEditGroup(data)">
                              <vab-icon icon="edit-line" />
                            </el-button>
                            <el-button link @click.stop="handleDeleteGroup(data)">
                              <vab-icon icon="delete-bin-line" />
                            </el-button>
                          </span>
                        </div>
                      </template>
                    </el-tree>
                    <el-empty v-if="groupList.length === 0" description="暂无分组，请先新增" :image-size="60" />
                  </div>
                </div>

                <div class="group-content-display" v-if="selectedGroup">
                  <h4>
                    {{ selectedGroup.groupName }}
                    <el-tag v-if="selectedGroup.schemaName" size="small" type="warning" style="margin-left: 6px;">
                      {{ selectedGroup.schemaName }}
                    </el-tag>
                    <small>已选项</small>
                  </h4>
                  <el-tree
                    :data="groupSelectedTables"
                    node-key="sourceTableId"
                    :props="{
                      label: 'tableName',
                      children: 'columns'
                    }"
                  >
                    <template #default="{ node, data }">
                      <div class="group-tree-node">
                        <span>{{ data.tableName || data.fieldName || data.name }}</span>
                        <span class="node-comment" v-if="data.displayName">({{ data.displayName }})</span>
                        <el-button
                          type="danger"
                          link
                          size="small"
                          class="delete-btn"
                          @click.stop="handleRemoveFromGroup(data, node)"
                          title="移除"
                        >
                          <vab-icon icon="delete-bin-line" />
                        </el-button>
                      </div>
                    </template>
                  </el-tree>
                  <el-empty v-if="groupSelectedTables.length === 0" description="暂无数据" />
                </div>
                <el-empty v-else description="请选择一个分组" style="margin-top: 20px;" />
              </div>
            </el-tab-pane>

            <!-- 数据库实例（浏览/切换源库） -->
            <el-tab-pane label="数据库" name="database">
              <div class="tab-content">
                <div class="card-header">
                  <el-input
                    v-model="dbSearchKeyword"
                    placeholder="搜索数据库"
                    clearable
                    style="width: 100%"
                  >
                    <template #prefix>
                      <vab-icon icon="search-line" />
                    </template>
                  </el-input>
                </div>
                <div class="tip-container">
                  <div class="tip-header" @click="toggleTipVisible">
                    <span>操作提示</span>
                    <vab-icon :icon="tipVisible ? 'arrow-up-s-line' : 'arrow-down-s-line'" />
                  </div>
                  <el-collapse-transition>
                    <div v-show="tipVisible" class="tip-content">
                      <p>1. 在「分组」中选择或新建分组（绑定一个库）</p>
                      <p>2. 选中分组后会自动加载该库的表</p>
                      <p>3. 勾选表字段 → 添加到分组 → 保存</p>
                      <p>4. 一个分组只能包含其绑定库中的表</p>
                    </div>
                  </el-collapse-transition>
                </div>
                <div class="tab-body">
                  <el-tree
                    ref="dbTree"
                    :data="filteredDbList"
                    :props="dbTreeProps"
                    node-key="instanceName"
                    highlight-current
                    default-expand-all
                    @node-click="handleDbClick"
                  >
                    <template #default="{ node, data }">
                      <div class="custom-tree-node">
                        <span>
                          <vab-icon :icon="data.type === 'instance' ? 'database-2-line' : 'table-line'" />
                          {{ node.label }}
                        </span>
                      </div>
                    </template>
                  </el-tree>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>

      <!-- 右侧表列表和字段内容区 -->
      <div class="right-content">
        <el-card class="box-card el-card-padding-0">
          <template #header>
            <div class="card-header">
              <div class="header-title">
                <span>数据表</span>
                <el-tag v-if="selectedGroup?.schemaName" size="small" type="warning" style="margin-left: 8px;">
                  当前分组库：{{ selectedGroup.schemaName }}
                </el-tag>
                <el-tag v-else-if="selectedInstance?.instanceName" size="small" type="info" style="margin-left: 8px;">
                  当前浏览：{{ selectedInstance.instanceName }}
                </el-tag>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="handleDirectAddToGroup" 
                  :disabled="!selectedGroup"
                  class="direct-add-btn"
                >
                  <vab-icon icon="add-line" />
                  添加到分组{{ selectedGroup ? '' : '(请先选择分组)' }}
                </el-button>

                <el-button 
                  type="primary" 
                  size="small" 
                  @click="saveGroup2DB"
                  :disabled="!selectedGroup"
                  class="direct-add-btn"
                >
                  <vab-icon icon="database-2-line" />
                  保存分组
                </el-button>
              </div>
              <div class="header-actions">
                <el-input
                  v-model="searchKeyword"
                  placeholder="搜索表名"
                  clearable
                  style="width: 200px"
                >
                  <template #prefix>
                    <vab-icon icon="search-line" />
                  </template>
                </el-input>
                <el-button-group>
                  <el-button type="primary" @click="handleSelectAll">
                    <vab-icon icon="checkbox-circle-line" />
                    全选
                  </el-button>
                  <el-button type="primary" @click="handleUnselectAll">
                    <vab-icon icon="checkbox-blank-circle-line" />
                    取消全选
                  </el-button>
                </el-button-group>
              </div>
            </div>
          </template>
          
          <!-- 增强表和字段的层次感 -->
          <el-tree
            v-loading="loading"
            :data="transformedTables"
            node-key="id"
            :props="{
              label: 'name',
              children: 'children'
            }"
            highlight-current
            show-checkbox
            check-strictly
            @check-change="handleTreeCheck"
            ref="tableTreeRef"
          >
            <template #default="{ node, data }">
              <div class="custom-tree-node table-tree-node">
                <!-- 显示表或字段信息 -->
                <div class="node-info">
                  <vab-icon :icon="data.isTable ? 'table-line' : 'file-list-line'" />
                  <span class="node-label">{{ node.label }}</span>
                  <span class="node-comment" v-if="data.comment">{{ data.comment }}</span>
                </div>
                
                <!-- 表节点的操作按钮 -->
                <div class="node-actions" v-if="data.isTable">
                  <el-button type="primary" link @click.stop="handleViewDDL(data)" title="查看DDL">
                    <vab-icon icon="code-line" />
                  </el-button>
                </div>
                
                <!-- 字段节点的类型信息 -->
                <div class="node-type" v-else>
                  <el-tag size="small" :type="data.isPrimary ? 'danger' : ''">
                    {{ data.dataType }}
                  </el-tag>
                  <el-tag v-if="data.isPrimary" size="small" type="warning" style="margin-left: 4px;">主键</el-tag>
                </div>
              </div>
            </template>
          </el-tree>
        </el-card>
      </div>
    </div>

    <!-- 分组表单对话框 -->
    <el-dialog
      v-model="groupDialogVisible"
      :title="groupDialogType === 'add' ? '新增分组' : '编辑分组'"
      width="500px"
      destroy-on-close
    >
      <el-form
        ref="groupFormRef"
        :model="groupForm"
        :rules="groupRules"
        label-width="80px"
      >
        <el-form-item label="分组名称" prop="groupName">
          <el-input v-model="groupForm.groupName" placeholder="请输入分组名称" />
        </el-form-item>
        <el-form-item label="所属数据库" prop="schemaName">
          <el-select
            v-model="groupForm.schemaName"
            placeholder="选择数据库实例（一个分组只能绑一个库）"
            :disabled="groupDialogType === 'edit'"
            style="width: 100%"
          >
            <el-option
              v-for="item in instanceOptions"
              :key="item.instanceName"
              :label="item.instanceName"
              :value="item.instanceName"
            />
          </el-select>
          <div v-if="groupDialogType === 'edit'" class="form-tip">所属库创建后不可修改</div>
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="groupForm.description" type="textarea" :rows="3" placeholder="请输入描述" />
        </el-form-item>
        <el-form-item label="排序" prop="orderNum">
          <el-input-number v-model="groupForm.orderNum" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleGroupSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- DDL查看对话框 -->
    <el-dialog
      v-model="ddlDialogVisible"
      title="表结构"
      width="800px"
      destroy-on-close
    >
      <el-input
        v-model="currentDDL"
        type="textarea"
        :rows="15"
        readonly
      />
      <template #footer>
        <el-button @click="ddlDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleCopyDDL">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.db-canvas-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  
  .toolbar {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  
  .main-content {
    display: flex;
    flex: 1;
    gap: 20px;
    min-height: 0;
    
    .el-card-padding-0 {
      .el-card__body {
        padding: 10px;
      }
    }

    .tip-content {
      font-size: 12px;
      line-height: 1.4;
      color: var(--el-text-color-regular);
      
      p {
        margin: 3px 0;
      }
    }
    
    .left-panel {
      flex-shrink: 0;
      width: 25%;
      
      .info-icon {
        margin-left: 8px;
        font-size: 16px;
        color: var(--el-color-info);
        cursor: pointer;
      }
      
      .tab-content {
        display: flex;
        flex-direction: column;
        
        .card-header {
          padding-top: 12px;
          margin-bottom: 16px;
        }
        
        .tab-body {
          flex: 1;
          overflow: auto;
        }
        
        .group-tree-body {
          height: 220px;
          overflow: auto;
          background-color: #fff;
          // padding: 8px;
          border-radius: 4px;
          box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
        }
      }
      
      .custom-tree-node {
        display: flex;
        gap: 4px;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding-right: 4px;
        font-size: 14px;

        .group-label {
          display: flex;
          gap: 4px;
          align-items: center;
          min-width: 0;

          .group-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .schema-tag {
            flex-shrink: 0;
          }
        }
        
        .actions {
          display: none;
          flex-shrink: 0;
        }
        
        &:hover .actions {
          display: inline-block;
        }
      }
      
      .group-content-display {
        flex: 1;
        padding: 12px;
        margin-top: 12px;
        overflow-y: auto;
        background-color: #fff;
        border-top: 1px solid var(--el-border-color-light);
        border-radius: 4px;
        box-shadow: 0 1px 3px rgb(0 0 0 / 10%);

        h4 {
          margin: 0 0 10px;
          font-size: 14px;
          color: var(--el-text-color-secondary);
          
          small {
            font-weight: normal;
            color: var(--el-text-color-placeholder);
          }
        }
        
        .group-tree-node {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          width: 100%;
          
          .node-comment {
            margin-left: 5px;
            font-size: 0.9em;
            color: var(--el-text-color-secondary);
          }
          
          .delete-btn {
            padding: 2px;
            margin-left: auto;
          }
        }

        .group-content-tabs {
          height: 100%;
          
          :deep(.el-tabs__content) {
            height: calc(100% - 40px);
            padding-top: 5px;
            overflow: auto;
          }
          
          .el-table {
            --el-table-header-bg-color: var(--el-fill-color-light);
          }
        }
      }
      
      .tip-container {
        margin-bottom: 15px;
        overflow: hidden;
        background-color: var(--el-color-info-light);
        border: 1px solid var(--el-border-color-light);
        border-radius: 4px;
        
        .tip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 15px;
          font-weight: bold;
          color: var(--el-color-info-dark);
          cursor: pointer;
          background-color: var(--el-color-info-light);
          
          &:hover {
            background-color: var(--el-color-info-lighter);
          }
        }
        
        .tip-content {
          padding: 10px 15px;
          font-size: 12px;
          line-height: 1.5;
          background-color: #fff;
          border-top: 1px solid var(--el-border-color-light);
          
          p {
            margin: 5px 0;
          }
        }
      }
    }
    
    .right-content {
      flex: 1;
      min-width: 0;
      
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        
        .header-title {
          display: flex;
          gap: 12px;
          align-items: center;
          
          .direct-add-btn {
            margin-left: 8px;
          }
        }
        
        .header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }
      }
      
      .table-tree-node {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 6px 0;
        
        .node-info {
          display: flex;
          gap: 8px;
          align-items: center;
          
          .node-label {
            font-weight: bold;
          }
          
          .node-comment {
            margin-left: 8px;
            color: var(--el-text-color-secondary);
          }
        }
        
        .node-type {
          font-size: 12px;
        }
      }
    }
  }
  
  :deep(.el-card) {
    display: flex;
    flex-direction: column;
    height: 100%;
    
    .el-card__body {
      flex: 1;
      overflow: hidden;
    }
    
  }

  .form-tip {
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
</style> 