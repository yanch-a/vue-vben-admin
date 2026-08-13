<script>
  import {
    computed,
    defineComponent,
    inject,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    toRefs,
    watch,
  } from 'vue'

  import { deleteQueryConfig, editQueryConfig, executeQueryConfig, exportQueryExcel, getDbConfigList, getGroupTablesWithColumns, getQueryConfigItems, getQueryConfigList, getTableGroupList, getVqDict, previewQuerySql, saveQueryItems } from '@/api/visual/vq'
  // Univer 0.25+
  import { LocaleType, mergeLocales, Univer } from "@univerjs/core";
  import { FUniver } from "@univerjs/core/facade";
  import DesignZhCN from '@univerjs/design/locale/zh-CN';
  import { UniverDocsPlugin } from "@univerjs/docs";
  import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
  import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN';
  import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
  import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
  import { UniverSheetsPlugin } from "@univerjs/sheets";
  import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
  import { UniverSheetsFormulaUIPlugin } from "@univerjs/sheets-formula-ui";
  import SheetsFormulaUIZhCN from '@univerjs/sheets-formula-ui/locale/zh-CN';
  import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
  import { UniverSheetsNumfmtUIPlugin } from "@univerjs/sheets-numfmt-ui";
  import SheetsNumfmtUIZhCN from '@univerjs/sheets-numfmt-ui/locale/zh-CN';
  import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
  import SheetsUIZhCN from '@univerjs/sheets-ui/locale/zh-CN';
  import SheetsZhCN from '@univerjs/sheets/locale/zh-CN';
  import { UniverUIPlugin } from "@univerjs/ui";
  import { UniverVue3AdapterPlugin } from "@univerjs/ui-adapter-vue3";
  import UIZhCN from '@univerjs/ui/locale/zh-CN';

  import '@univerjs/engine-formula/facade';
  import '@univerjs/ui/facade';
  import '@univerjs/docs-ui/facade';
  import '@univerjs/sheets/facade';
  import '@univerjs/sheets-ui/facade';
  import '@univerjs/sheets-formula/facade';
  import '@univerjs/sheets-numfmt/facade';

  import "@univerjs/design/lib/index.css";
  import "@univerjs/ui/lib/index.css";
  import "@univerjs/docs-ui/lib/index.css";
  import "@univerjs/sheets-ui/lib/index.css";
  import "@univerjs/sheets-formula-ui/lib/index.css";
  import "@univerjs/sheets-numfmt-ui/lib/index.css";
  
  export default defineComponent({
    name: 'VisualQuery',
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')
      const univerContainer = ref(null)
      const dbTree = ref(null);
      const configFormRef = ref(null);
      let univerInstance = null;
      let univerAPI = null;
      
      // 查询配置表单验证规则
      const configRules = {
        configName: [
          { required: true, message: '请输入配置名称', trigger: 'blur' },
          { max: 100, message: '配置名称不能超过100个字符', trigger: 'blur' }
        ],
        groupId: [
          { required: true, message: '请选择所属分组', trigger: 'change' }
        ],
        description: [
          { max: 500, message: '配置描述不能超过500个字符', trigger: 'blur' }
        ],
        orderNum: [
          { required: true, message: '请输入排序值', trigger: 'blur' },
          { type: 'number', min: 0, max: 9999, message: '排序值必须在0-9999之间', trigger: 'blur' }
        ]
      }
      
      // 计算属性：是否有选中的字段
      const hasSelectedFields = computed(() => {
        return state.columnList.length > 0
      })
      
      // 响应式状态
      const state = reactive({
        // 面板宽度控制
        leftPanelWidth: '20%',
        rightPanelWidth: '80%',
        isResizing: false,
        
        // 树形控件相关
        activeName: 'tables',
        filterText: '',
        dbTables: [], // 数据库表和字段树
        treeProps: {
          label: 'displayName',
          children: 'columns'
        },
        
        // 已选字段和条件
        columnList: [],
        allFields: [],
        whereList: [],
        
        // 对话框控制
        aliasDialogVisible: false,
        functionDialogVisible: false,
        customizeDialogVisible: false,
        customizeTab: 'basic',
        currentField: {},
        
        // 分组相关
        groupList: [],
        // 排序相关
        orderList: [],
        
        // QueryConfigItem对象列表
        columnItems: [], // 对应COLUMN类型的QueryConfigItem
        whereItems: [],  // 对应WHERE类型的QueryConfigItem
        groupItems: [],  // 对应GROUP类型的QueryConfigItem
        orderItems: [],  // 对应ORDER类型的QueryConfigItem
        
        // sql运算符
        conditionOperator: [],
        // 数据库类型
        dataBaseType: [],
        // sql函数
        dbFunctionType: [],
         // 排序方式
        orderType: [],
        
        // 数据库和分组选择
        currentDbConfig: '',
        currentTableGroup: '',
        dbConfigList: [],
        tableGroupList: [],
        
        // 查询配置历史记录
        configVisible: false,
        queryConfigList: [],
        configDialogVisible: false,
        configDialogMode: 'add', // 'add' | 'edit'
        currentConfig: {
          id: null,
          configName: '',
          groupId: null,
          description: '',
          isPublic: 0,
          orderNum: 0
        },
        currentConfigItems: null, // 暂存当前查询的字段配置
        selectConfig: null, // 暂存当前查询的数据

        // 真实执行相关
        executing: false,
        exporting: false,
        sqlPreviewVisible: false,
        sqlPreview: null,
        lastQueryResult: null
      })
      
      // 监听过滤文本变化
      watch(() => state.filterText, (val) => {
        dbTree.value.filter(val);
      });
      
      // 过滤节点方法
      const filterNode = (value, data) => {
        if (!value) return true;
        return data.name.includes(value);
      };
      
      // 创建QueryConfigItem对象
      const createQueryConfigItem = (field, queryType, extraProps = {}) => {
        return {
          configId: state.currentConfig.id,
          fieldId: field.id,
          queryType,
          alias: field.alias || '',
          functionType: field.functionType,
          customSql: field.customSql || '',
          sortDirection: extraProps.sortDirection || '',
          conditionOperator: extraProps.conditionOperator || '',
          conditionValue: extraProps.conditionValue || '',
          orderNum: extraProps.orderNum || 0
        }
      }
      
      // 同步字段到columnItems
      const syncFieldToColumnItems = (field, action = 'add') => {
        const existingIndex = state.columnItems.findIndex(item => item.fieldId === field.id)
        
        if (action === 'add' && existingIndex === -1) {
          // 添加新的columnItem
          const orderNum = state.columnItems.length + 1
          const columnItem = createQueryConfigItem(field, 'COLUMN', { orderNum })
          state.columnItems.push(columnItem)
        } else if (action === 'update' && existingIndex !== -1) {
          // 更新现有的columnItem
          const columnItem = state.columnItems[existingIndex]
          columnItem.alias = field.alias || ''
          columnItem.functionType = field.functionType
          columnItem.customSql = field.customSql || ''
        } else if (action === 'remove' && existingIndex !== -1) {
          // 移除columnItem
          state.columnItems.splice(existingIndex, 1)
          // 重新排序orderNum
          state.columnItems.forEach((item, index) => {
            item.orderNum = index + 1
          })
        }
      }
      
      // 更新字段属性并同步到columnItems
      const updateFieldAndSync = (fieldId, property, value) => {
        // 更新columnList中的字段
        const field = state.columnList.find(f => f.id === fieldId)
        if (field) {
          field[property] = value
          syncFieldToColumnItems(field, 'update')
        }
        
        // 更新树中的字段属性
        state.dbTables.forEach(table => {
          const treeField = table.columns.find(f => f.id === fieldId)
          if (treeField) {
            treeField[property] = value
          }
        })
      }
      
      // 处理树节点勾选
      const handleCheck = (data, checked) => {
        const { checkedNodes } = checked;
        
        // 获取新选中的字段节点
        const newColumnList = checkedNodes.filter(node => {
          if(!node.fieldName){
            return false
          }else{
            return true
          }
        }).map(node => ({ ...node }));
        
        // 找出新增和移除的字段
        const oldFieldIds = new Set(state.columnList.map(field => field.id))
        const newFieldIds = new Set(newColumnList.map(field => field.id))
        
        // 处理新增的字段
        newColumnList.forEach(field => {
          if (!oldFieldIds.has(field.id)) {
            syncFieldToColumnItems(field, 'add')
          }
        })
        
        // 处理移除的字段
        state.columnList.forEach(field => {
          if (!newFieldIds.has(field.id)) {
            syncFieldToColumnItems(field, 'remove')
          }
        })
        
        // 更新columnList
        state.columnList = newColumnList;
      };
      
      // 设置别名
      const setAlias = (data) => {
        state.currentField = JSON.parse(JSON.stringify(data));
        state.aliasDialogVisible = true;
      };
      
      // 保存别名
      const saveAlias = () => {
        // 更新树节点和已选字段中的别名
        updateFieldAndSync(state.currentField.id, 'alias', state.currentField.alias);
        state.aliasDialogVisible = false;
      };
      
      // 自定义字段设置
      const customizeField = (data) => {
        state.currentField = JSON.parse(JSON.stringify(data));
        if (!state.currentField.customSql) {
          state.currentField.customSql = '';
        }
        state.customizeDialogVisible = true;
      };
      
      // 保存自定义字段设置
      const saveCustomize = () => {
        // 更新字段的所有自定义属性
        const fieldId = state.currentField.id;
        updateFieldAndSync(fieldId, 'alias', state.currentField.alias);
        updateFieldAndSync(fieldId, 'functionType', state.currentField.functionType);
        updateFieldAndSync(fieldId, 'sort', state.currentField.sort);
        updateFieldAndSync(fieldId, 'customSql', state.currentField.customSql);
        
        state.customizeDialogVisible = false;
      };
      
      // 上移字段
      const moveFieldUp = (index) => {
        if (index > 0) {
          const temp = state.columnList[index];
          state.columnList.splice(index, 1);
          state.columnList.splice(index - 1, 0, temp);
          
          // 同步orderNum到columnItems
          state.columnItems.forEach((item, idx) => {
            item.orderNum = idx + 1
          })
        }
      };
      
      // 下移字段
      const moveFieldDown = (index) => {
        if (index < state.columnList.length - 1) {
          const temp = state.columnList[index];
          state.columnList.splice(index, 1);
          state.columnList.splice(index + 1, 0, temp);
          
          // 同步orderNum到columnItems
          state.columnItems.forEach((item, idx) => {
            item.orderNum = idx + 1
          })
        }
      };
      
      // 添加分组
      const addGroup = () => {
        const groupField = {
          fieldId: '',
          name: ''
        }
        state.groupList.push(groupField);
        
        // 同步到groupItems
        const groupItem = createQueryConfigItem({ id: null }, 'GROUP', { 
          orderNum: state.groupItems.length + 1 
        })
        state.groupItems.push(groupItem)
      };
      
      // 删除分组
      const removeGroup = (index) => {
        state.groupList.splice(index, 1);
        state.groupItems.splice(index, 1);
        
        // 重新排序orderNum
        state.groupItems.forEach((item, idx) => {
          item.orderNum = idx + 1
        })
      };
      
      // 添加排序
      const addOrder = () => {
        const orderField = {
          fieldId: '',
          orderType: 'ASC'
        }
        state.orderList.push(orderField);
        
        // 同步到orderItems
        const orderItem = createQueryConfigItem({ id: null }, 'ORDER', { 
          sortDirection: 'ASC',
          orderNum: state.orderItems.length + 1 
        })
        state.orderItems.push(orderItem)
      };
      
      // 删除排序
      const removeOrder = (index) => {
        state.orderList.splice(index, 1);
        state.orderItems.splice(index, 1);
        
        // 重新排序orderNum
        state.orderItems.forEach((item, idx) => {
          item.orderNum = idx + 1
        })
      };
      
      // 添加查询条件
      const addCondition = () => {
        const condition = {
          field: '',
          operator: '=',
          value: ''
        }
        state.whereList.push(condition);
        
        // 同步到whereItems
        const whereItem = createQueryConfigItem({ id: null }, 'WHERE', { 
          conditionOperator: '=',
          conditionValue: '',
          orderNum: state.whereItems.length + 1 
        })
        state.whereItems.push(whereItem)
      };
      
      // 移除查询条件
      const removeCondition = (index) => {
        state.whereList.splice(index, 1);
        state.whereItems.splice(index, 1);
        
        // 重新排序orderNum
        state.whereItems.forEach((item, idx) => {
          item.orderNum = idx + 1
        })
      };
      
      // 更新whereItem
      const updateWhereItem = (index, property, value) => {
        if (state.whereItems[index]) {
          state.whereItems[index][property] = value
        }
      }
      
      // 更新groupItem
      const updateGroupItem = (index, property, value) => {
        if (state.groupItems[index]) {
          state.groupItems[index][property] = value
        }
      }
      
      // 更新orderItem
      const updateOrderItem = (index, property, value) => {
        if (state.orderItems[index]) {
          state.orderItems[index][property] = value
        }
        // 同时更新orderList中的对应值
        if (property === 'sortDirection' && state.orderList[index]) {
          state.orderList[index].orderType = value
        }
      }
      
      // 校验当前是否已保存配置（真实执行都基于后端配置）
      const ensureConfigSaved = () => {
        if (!state.currentConfig || !state.currentConfig.id) {
          $baseMessage('请先保存查询配置（新建配置并保存字段项），再执行查询', 'warning');
          return false;
        }
        return true;
      };

      // 执行查询（调后端 /queryExecute/execute）
      const executeQuery = async () => {
        if (!ensureConfigSaved()) return;
        state.executing = true;
        try {
          const { data } = await executeQueryConfig(state.currentConfig.id);
          state.lastQueryResult = data;
          if (!data || !data.rows || data.rows.length === 0) {
            $baseMessage('查询成功，但没有数据', 'warning');
          }
          renderUniver(data.columns || [], data.rows || []);
          if (data.path && data.path.intermediateTableIds && data.path.intermediateTableIds.length) {
            $baseMessage(`已自动引入 ${data.path.intermediateTableIds.length} 张中间表完成关联`, 'info');
          }
        } catch (error) {
          console.error('执行查询失败:', error);
        } finally {
          state.executing = false;
        }
      };

      // SQL 预览（不执行）
      const previewSql = async () => {
        if (!ensureConfigSaved()) return;
        try {
          const { data } = await previewQuerySql(state.currentConfig.id);
          state.sqlPreview = data;
          state.sqlPreviewVisible = true;
        } catch (error) {
          console.error('SQL预览失败:', error);
        }
      };
      
      // 初始化Univer实例
      const initUniver = () => {
        if (!univerContainer.value) return;

        try {
          // 销毁旧实例，避免重复挂载
          if (univerAPI) {
            univerAPI.dispose?.();
            univerAPI = null;
          }
          if (univerInstance) {
            univerInstance.dispose();
            univerInstance = null;
          }

          univerInstance = new Univer({
            locale: LocaleType.ZH_CN,
            locales: {
              [LocaleType.ZH_CN]: mergeLocales(
                DesignZhCN,
                UIZhCN,
                DocsUIZhCN,
                SheetsZhCN,
                SheetsUIZhCN,
                SheetsFormulaUIZhCN,
                SheetsNumfmtUIZhCN,
              ),
            },
          });
          
          univerInstance.registerPlugin(UniverRenderEnginePlugin);
          univerInstance.registerPlugin(UniverFormulaEnginePlugin);
          
          univerInstance.registerPlugin(UniverUIPlugin, {
            container: univerContainer.value,
          });
          univerInstance.registerPlugin(UniverVue3AdapterPlugin);
          univerInstance.registerPlugin(UniverDocsPlugin);
          univerInstance.registerPlugin(UniverDocsUIPlugin);
          
          univerInstance.registerPlugin(UniverSheetsPlugin);
          univerInstance.registerPlugin(UniverSheetsUIPlugin);
          univerInstance.registerPlugin(UniverSheetsFormulaPlugin);
          univerInstance.registerPlugin(UniverSheetsFormulaUIPlugin);
          univerInstance.registerPlugin(UniverSheetsNumfmtPlugin);
          univerInstance.registerPlugin(UniverSheetsNumfmtUIPlugin);
          
          univerAPI = FUniver.newAPI(univerInstance);
          univerAPI.createWorkbook({ name: '查询结果' });
        } catch (error) {
          console.error('初始化Univer时出错:', error);
          $baseMessage('初始化表格组件失败，请刷新页面重试', 'error');
        }
      };
      
      // 上次渲染的区域大小（用于覆盖清空）
      let lastRenderRows = 0;
      let lastRenderCols = 0;

      // 将数据渲染到Univer（columns: 列标签数组，rows: 行对象数组）
      const renderUniver = (columns, rows) => {
        try {
          if (!univerAPI) {
            initUniver();
          }
          const workbook = univerAPI.getActiveWorkbook();
          if (!workbook) {
            $baseMessage('无法获取工作簿', 'error');
            return;
          }
          const sheet = workbook.getActiveSheet();
          if (!sheet) {
            $baseMessage('无法获取工作表', 'error');
            return;
          }

          // 覆盖清空上次渲染的区域
          if (lastRenderRows > 0 && lastRenderCols > 0) {
            const emptyValues = Array.from({ length: lastRenderRows }, () =>
              Array.from({ length: lastRenderCols }, () => null)
            );
            sheet.getRange(0, 0, lastRenderRows, lastRenderCols).setValues(emptyValues);
          }

          if (!columns.length) {
            lastRenderRows = 0;
            lastRenderCols = 0;
            return;
          }

          // 表头 + 数据组成二维数组，一次性写入
          const values = [columns.map(c => String(c))];
          rows.forEach(rowData => {
            values.push(columns.map(c => {
              const v = rowData[c];
              return v === null || v === undefined ? '' : v;
            }));
          });
          sheet.getRange(0, 0, values.length, columns.length).setValues(values);

          lastRenderRows = values.length;
          lastRenderCols = columns.length;
          $baseMessage(`数据加载成功，共 ${rows.length} 行`, 'success');
        } catch (error) {
          console.error('渲染数据到Univer时出错:', error);
          $baseMessage('渲染表格数据失败', 'error');
        }
      };
      
      // 导出Excel（后端生成，流式下载）
      const exportExcel = async () => {
        if (!ensureConfigSaved()) return;
        state.exporting = true;
        try {
          const blob = await exportQueryExcel(state.currentConfig.id);
          const url = window.URL.createObjectURL(new Blob([blob]));
          const link = document.createElement('a');
          link.href = url;
          link.download = `${state.currentConfig.configName || '查询导出'}.xlsx`;
          link.click();
          window.URL.revokeObjectURL(url);
          $baseMessage('导出成功', 'success');
        } catch (error) {
          console.error('导出Excel失败:', error);
          $baseMessage('导出失败', 'error');
        } finally {
          state.exporting = false;
        }
      };
      
      // 保存查询（等同保存当前配置的字段项）
      const saveQuery = () => {
        saveQueryConfigItems();
      };
      
      // === 查询配置相关方法 ===
      
      // 切换配置区域显示/隐藏
      const toggleConfigVisible = () => {
        state.configVisible = !state.configVisible
        // 保存状态到localStorage
        localStorage.setItem('queryConfigVisible', state.configVisible)
      }
      
      // 显示配置对话框
      const showConfigDialog = (mode, config = null) => {
        state.configDialogMode = mode
        
        if (mode === 'add') {
          state.currentConfig = {
            id: null,
            configName: '',
            groupId: state.currentTableGroup || null,
            description: '',
            isPublic: 0,
            orderNum: 0
          }
        } else if (mode === 'edit' && config) {
          state.currentConfig = { ...config }
        }
        
        state.configDialogVisible = true
      }
      
      // 保存查询配置
      const saveQueryConfig = async () => {
        if (!configFormRef.value) return
        
        try {
          await configFormRef.value.validate()
          // 新增的时候会把对象返回
          const { data, msg } = await editQueryConfig(state.currentConfig)
          $baseMessage(msg, 'success')
          // 重新加载查询配置列表
          await loadQueryConfigList()
          
          state.configDialogVisible = false
          if(state.configDialogMode === 'add') {
            state.currentConfig = data
            // 保存当前勾选的数据项配置
            saveQueryConfigItems()
            // 清空暂存的items
            // state.currentConfigItems = null
          }
        } catch (error) {
          console.error('保存查询配置失败:', error)
          $baseMessage('保存配置失败', 'error')
        }
      }

      // 保存查询配置
      const saveQueryConfigItems = async () => {
        if (!state.currentConfig.id) {
          // 新数据，打开新增配置对话框
          showConfigDialog('add')
          return
        }
        try {
          const configData = [
            ...state.columnItems,
            ...state.whereItems,
            ...state.groupItems,
            ...state.orderItems
          ]
          for (const item of configData) {
            // 做转换，后台是枚举类型
            if(item.conditionOperator === '') {
              item.conditionOperator = null
            }
            if(item.functionType === '') {
              item.functionType = null
            }
          }

          const { msg } = await saveQueryItems(state.currentConfig.id, configData)
          $baseMessage(msg, 'success')
          // 清空暂存的items
          // state.currentConfigItems = null
          
        } catch (error) {
          console.error('保存查询配置失败:', error)
          $baseMessage('保存配置失败', 'error')
        }
      }
      
      // 选择查询配置
      const selectQueryConfig = async (config) => {
        state.selectConfig = config
        // 后续执行/预览/导出/保存字段项都基于该配置
        state.currentConfig = { ...config }
        try {
          // 调用后端API获取完整的配置信息
          const { data } = await getQueryConfigItems(config.id)
          const fullConfigVo = data
          
          // 切换到对应的分组
          if (config.groupId !== state.currentTableGroup) {
            state.currentTableGroup = config.groupId
            await handleGroupChange()
          }
          
          // 等待数据加载完成后再进行回显
          await nextTick()
          
          // 清空当前所有选择和配置
          clearAllSelections()
          
          // 回显数据
          await restoreFromConfigVo(fullConfigVo)
          
          $baseMessage(`已加载配置"${config.configName}"`, 'success')
          
        } catch (error) {
          console.error('加载查询配置失败:', error)
          $baseMessage('加载配置失败', 'error')
        }
      }
      
      // 清空所有选择和配置
      const clearAllSelections = () => {
        // 清空树的选中状态
        if (dbTree.value) {
          dbTree.value.setCheckedKeys([])
        }
        
        // 清空所有列表
        state.columnList = []
        state.whereList = []
        state.groupList = []
        state.orderList = []
        
        // 清空所有items
        state.columnItems = []
        state.whereItems = []
        state.groupItems = []
        state.orderItems = []
      }
      
      // 从QueryConfigItemVo恢复数据
      const restoreFromConfigVo = async (configVo) => {
        // 恢复字段列表
        if (configVo.columnItems && configVo.columnItems.length > 0) {
          await restoreColumnItems(configVo.columnItems)
        }
        
        // 恢复查询条件
        if (configVo.whereItems && configVo.whereItems.length > 0) {
          restoreWhereItems(configVo.whereItems)
        }
        
        // 恢复分组
        if (configVo.groupItems && configVo.groupItems.length > 0) {
          restoreGroupItems(configVo.groupItems)
        }
        
        // 恢复排序
        if (configVo.orderItems && configVo.orderItems.length > 0) {
          restoreOrderItems(configVo.orderItems)
        }
      }
      
      // 恢复字段列表
      const restoreColumnItems = async (columnItems) => {
        const fieldsToCheck = []
        
        // 按orderNum排序
        const sortedItems = [...columnItems].sort((a, b) => a.orderNum - b.orderNum)
        
        for (const item of sortedItems) {
          // 在树中找到对应的字段
          const fieldNode = findFieldInTree(item.fieldId)
          if (fieldNode) {
            // 更新字段的自定义属性
            fieldNode.alias = item.alias || ''
            fieldNode.functionType = item.functionType
            fieldNode.customSql = item.customSql || ''
            
            // 添加到选中字段列表
            state.columnList.push({
              ...fieldNode,
              alias: item.alias || '',
              functionType: item.functionType,
              customSql: item.customSql || ''
            })
            
            fieldsToCheck.push(item.fieldId)
          }
        }
        
        // 设置树的选中状态
        if (dbTree.value && fieldsToCheck.length > 0) {
          dbTree.value.setCheckedKeys(fieldsToCheck)
        }
        
        // 恢复columnItems
        state.columnItems = [...columnItems]
      }
      
      // 恢复查询条件
      const restoreWhereItems = (whereItems) => {
        const sortedItems = [...whereItems].sort((a, b) => a.orderNum - b.orderNum)
        
        state.whereList = sortedItems.map(item => ({
          field: item.fieldId,
          operator: item.conditionOperator || '=',
          value: item.conditionValue || ''
        }))
        
        state.whereItems = [...whereItems]
      }
      
      // 恢复分组
      const restoreGroupItems = (groupItems) => {
        const sortedItems = [...groupItems].sort((a, b) => a.orderNum - b.orderNum)
        
        state.groupList = sortedItems.map(item => ({
          fieldId: item.fieldId,
          name: ''
        }))
        
        state.groupItems = [...groupItems]
      }
      
      // 恢复排序
      const restoreOrderItems = (orderItems) => {
        const sortedItems = [...orderItems].sort((a, b) => a.orderNum - b.orderNum)
        
        state.orderList = sortedItems.map(item => ({
          fieldId: item.fieldId,
          orderType: item.sortDirection || 'ASC'
        }))
        
        state.orderItems = [...orderItems]
      }
      
      // 在树中查找字段
      const findFieldInTree = (fieldId) => {
        for (const table of state.dbTables) {
          if (table.columns) {
            const field = table.columns.find(f => f.id === fieldId)
            if (field) return field
          }
        }
        return null
      }
      
      // 删除查询配置
      const deleteQueryConfigMethod = async (config) => {
        try {
          $baseConfirm('你确定要删除当前项吗', null, async () => {
            // 调用后端API删除配置
            const { data } = await deleteQueryConfig(config.id)
            $baseMessage(data, 'success')
            // 重新加载查询配置列表
            await loadQueryConfigList()
          })
        } catch (error) {
          if (error !== 'cancel') {
            console.error('删除查询配置失败:', error)
            $baseMessage('删除配置失败', 'error')
          }
        }
      }
      
      // 加载查询配置列表
      const loadQueryConfigList = async () => {
        try {
          if (!state.currentTableGroup) return
          // 调用后端API获取配置列表
          const { data } = await getQueryConfigList({ groupId: state.currentTableGroup })
          state.queryConfigList = data
        } catch (error) {
          console.error('加载查询配置列表失败:', error)
        }
      }
      
      // 开始调整面板大小
      const startResize = (e) => {
        state.isResizing = true;
        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
      };
      
      // 处理面板大小调整
      const handleResize = (e) => {
        if (!state.isResizing) return;
        
        // 获取容器相对于视口的位置信息
        const container = document.querySelector('.visual-query-container');
        const containerRect = container.getBoundingClientRect();
        
        // 计算鼠标位置相对于容器左边界的距离
        const mouseXRelativeToContainer = e.clientX - containerRect.left;
        
        // 计算相对百分比
        const percentage = (mouseXRelativeToContainer / containerRect.width) * 100;
        
        // 限制左侧面板最小10%，最大80%
        const clampedPercentage = Math.max(10, Math.min(80, percentage));
        
        // 更新面板宽度
        state.leftPanelWidth = `${clampedPercentage}%`;
        state.rightPanelWidth = `${100 - clampedPercentage}%`;
      };
      
      // 停止调整面板大小
      const stopResize = () => {
        state.isResizing = false;
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', stopResize);
      };

      // 选择数据
      const selectData = (config) => {

        console.log(config)
      }

      const initParams = async () => {
        const { data } = await getVqDict()
        state.conditionOperator = data.conditionOperator
        state.dataBaseType = data.dataBaseType
        state.dbFunctionType = data.dbFunctionType
        state.orderType = data.orderType 
        
        // 加载数据库配置列表
        await loadDbConfigList()
      };
      
      // 加载数据库配置列表
      const loadDbConfigList = async () => {
        try {
          const { data } = await getDbConfigList()
          state.dbConfigList = data
          
          // 如果有数据库配置，默认选择第一个
          if (data && data.length > 0) {
            state.currentDbConfig = data[0].id
            // 加载该数据库的表分组
            await loadTableGroupList(state.currentDbConfig)
          }
        } catch (error) {
          console.error('加载数据库配置失败:', error)
          $baseMessage('加载数据库配置失败', 'error')
        }
      }
      
      // 加载表分组列表
      const loadTableGroupList = async (dbConfigId) => {
        if (!dbConfigId) return
        
        try {
          const { data } = await getTableGroupList({ dbConfigId })
          state.tableGroupList = data
          
          // 如果有表分组，默认选择第一个
          if (data && data.length > 0) {
            state.currentTableGroup = data[0].id
            // 加载该分组的表和字段
            await loadTablesWithColumns(state.currentDbConfig, state.currentTableGroup)
            // 加载查询配置列表
            loadQueryConfigList()
          }
        } catch (error) {
          console.error('加载表分组失败:', error)
          $baseMessage('加载表分组失败', 'error')
        }
      }
      
      // 加载表和字段
      const loadTablesWithColumns = async (dbConfigId, groupId) => {
        if (!dbConfigId || !groupId) return

        try {
          const { data } = await getGroupTablesWithColumns(state.currentTableGroup)
          
          // 转换数据格式为树形结构
          state.dbTables = data
          
          // 提取所有字段用于选择条件
          state.allFields = state.dbTables.flatMap(table => 
            table.columns.map(field => ({ 
              ...field,
              name: `${table.displayName}.${field.displayName}`
            }))
          )
          
          $baseMessage('加载表和字段成功', 'success')
        } catch (error) {
          console.error('加载表和字段失败:', error)
          $baseMessage('加载表和字段失败', 'error')
        }
      }
      
      // 处理数据库变更
      const handleDbChange = async (dbConfigId) => {
        state.currentTableGroup = ''
        state.tableGroupList = []
        state.dbTables = []
        state.allFields = []
        state.columnList = []
        
        // 加载新选择的数据库的表分组
        await loadTableGroupList(dbConfigId)
      }
      
      // 处理分组变更
      const handleGroupChange = async (groupId) => {
        state.dbTables = []
        state.allFields = []
        state.columnList = []
        
        // 加载新选择的分组的表和字段
        await loadTablesWithColumns(state.currentDbConfig, groupId)
        
        // 加载该分组的查询配置列表
        await loadQueryConfigList()
      }
      
      // 初始化
      onMounted(() => {
        // 从localStorage恢复配置区域的显示状态
        const savedConfigVisible = localStorage.getItem('queryConfigVisible')
        if (savedConfigVisible !== null) {
          state.configVisible = savedConfigVisible === 'true'
        }
        
        initParams()
        initUniver();
        
      });
      
      // 组件卸载前清理事件监听与 Univer 实例
      onBeforeUnmount(() => {
        if (state.isResizing) {
          document.removeEventListener('mousemove', handleResize);
          document.removeEventListener('mouseup', stopResize);
        }
        try {
          univerAPI?.dispose?.();
          univerInstance?.dispose?.();
        } catch (e) {
          console.warn('销毁 Univer 实例失败:', e);
        }
        univerAPI = null;
        univerInstance = null;
      });
      
      return {
        ...toRefs(state),
        dbTree,
        univerContainer,
        configFormRef,
        configRules,
        hasSelectedFields,
        filterNode,
        handleCheck,
        setAlias,
        saveAlias,
        customizeField,
        saveCustomize,
        moveFieldUp,
        moveFieldDown,
        addGroup,
        removeGroup,
        addOrder,
        removeOrder,
        addCondition,
        removeCondition,
        updateWhereItem,
        updateGroupItem,
        updateOrderItem,
        executeQuery,
        previewSql,
        exportExcel,
        saveQuery,
        startResize,
        handleDbChange,
        handleGroupChange,
        // 查询配置相关方法
        toggleConfigVisible,
        showConfigDialog,
        saveQueryConfig,
        saveQueryConfigItems,
        selectQueryConfig,
        deleteQueryConfigMethod,
        loadQueryConfigList
      };
    },
  })
</script>

<template>
  <div class="visual-query-container">
    <!-- 左侧配置区域 -->
    <div class="left-panel" :style="{ width: leftPanelWidth }">
      <div class="panel-header">
        <h3>查询视图配置</h3>
        <div>
          <el-button size="small" @click="previewSql">SQL预览</el-button>
          <el-button type="primary" size="small" :loading="executing" @click="executeQuery">执行查询</el-button>
        </div>
      </div>
      
      <!-- 添加数据库和分组选择框 -->
      <div class="db-selector">
        <el-form :inline="true" size="small">
          <el-form-item label="选择：">
            <el-select v-model="currentDbConfig" placeholder="选择数据库" @change="handleDbChange">
              <el-option
                v-for="item in dbConfigList"
                :key="item.id"
                :label="item.dbName"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="currentTableGroup" placeholder="选择分组" @change="handleGroupChange">
              <el-option
                v-for="item in tableGroupList"
                :key="item.id"
                :label="item.groupName"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      
      <!-- 查询配置历史记录 -->
      <div class="query-config-section">
        <div class="config-header" @click="toggleConfigVisible">
          <span>查询配置历史</span>
          <vab-icon :icon="configVisible ? 'arrow-up-s-line' : 'arrow-down-s-line'" />
        </div>
        <el-collapse-transition>
          <div v-show="configVisible" class="config-content">
            <div class="config-actions">
              <el-button type="primary" size="small" @click="showConfigDialog('add')">
                <vab-icon icon="add-line" />
                新建配置
              </el-button>
              <el-button type="success" size="small" @click="saveQueryConfigItems" :disabled="!hasSelectedFields">
                <vab-icon icon="save-line" />
                保存/更新当前配置
              </el-button>
            </div>
            
            <div class="config-list">
              <el-table :data="queryConfigList" size="small">
                <el-table-column label="配置名称" prop="configName" />
                <!-- <el-table-column label="描述" prop="description" show-overflow-tooltip /> -->
                <el-table-column label="公开" prop="isPublic" width="60">
                  <template #default="{ row }">
                    <el-tag :type="row.isPublic ? 'success' : 'info'" size="small">
                      {{ row.isPublic ? '公开' : '私有' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="140">
                  <template #default="{ row }">
                    <el-button-group>
                      <el-button link size="small" @click.stop="showConfigDialog('edit', row)" title="编辑">
                      <vab-icon icon="edit-line" />
                      </el-button>
                      <el-button link size="small" @click.stop="deleteQueryConfigMethod(row)" title="删除">
                        <vab-icon icon="delete-bin-line" />
                      </el-button>
                      <el-button link size="small" @click.stop="selectQueryConfig(row)" title="选择数据">
                        <vab-icon icon="check-double-fill" />
                      </el-button>
                    </el-button-group>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-if="queryConfigList.length === 0" description="暂无查询配置" />
            </div>
          </div>
        </el-collapse-transition>
      </div>
      
      <el-tabs v-model="activeName" class="config-tabs">
        <!-- 表和字段配置 -->
        <el-tab-pane label="表和字段" name="tables">
          <el-input
            v-model="filterText"
            placeholder="输入关键字过滤"
            clearable
            prefix-icon="search-line"
          />
          
          <el-tree
            ref="dbTree"
            :data="dbTables"
            :props="treeProps"
            show-checkbox
            node-key="id"
            :filter-node-method="filterNode"
            @check="handleCheck"
          >
            <template #default="{ data }">
              <span class="custom-tree-node">
                <span>{{ data.tableName ? data.tableName : `${data.fieldName }  (${ data.displayName })` }}</span>
                <span class="node-actions" v-if="data.sourceFieldId != null">
                  <el-tooltip content="自定义设置" placement="top">
                    <el-button link size="small" @click.stop="customizeField(data)">
                      <vab-icon icon="settings-line" />
                    </el-button>
                  </el-tooltip>
                </span>
              </span>
            </template>
          </el-tree>
        </el-tab-pane>
        
        <!-- 排序和条件配置 -->
        <el-tab-pane label="排序和条件" name="conditions">
          <div class="condition-group">
            <h4>已选字段</h4>
            <el-table :data="columnList" size="small" row-key="id">
              <el-table-column label="字段" prop="fieldName" />
              <el-table-column label="字段名" prop="displayName" />
              <el-table-column label="操作" width="140">
                <template #default="{ row, $index }">
                  <el-button-group>
                    <el-button link size="small" @click="moveFieldUp($index)" :disabled="$index === 0">
                      <vab-icon icon="arrow-up-line" />
                    </el-button>
                    <el-button link size="small" @click="moveFieldDown($index)" :disabled="$index === columnList.length - 1">
                      <vab-icon icon="arrow-down-line" />
                    </el-button>
                    <el-button link size="small" @click="customizeField(row)">
                      <vab-icon icon="settings-line" />
                    </el-button>
                  </el-button-group>
                </template>
              </el-table-column>
            </el-table>
          </div>
          
          <div class="condition-group">
            <h4>查询条件</h4>
            <div v-for="(condition, index) in whereList" :key="index" class="condition-item">
              <el-select v-model="condition.field" placeholder="选择字段" filterable @change="updateWhereItem(index, 'fieldId', condition.field)">
                <el-option 
                  v-for="field in allFields" 
                  :key="field.id" 
                  :label="field.name" 
                  :value="field.id" 
                />
              </el-select>
              <el-select v-model="condition.operator" placeholder="条件" @change="updateWhereItem(index, 'conditionOperator', condition.operator)">
                <el-option
                  v-for="item in conditionOperator"
                  :key="item.code"
                  :label="item.label"
                  :value="item.code"
                />
              </el-select>
              <el-input v-model="condition.value" placeholder="值" @input="updateWhereItem(index, 'conditionValue', condition.value)" />
              <el-button type="danger" icon="delete-bin-line" circle @click="removeCondition(index)" />
            </div>
            <el-button type="primary" @click="addCondition">添加条件</el-button>
          </div>
          
          <div class="condition-group">
            <h4>分组设置</h4>
            <div class="group-section">
              <div class="group-header">
                <span>分组字段</span>
                <el-button type="primary" size="small" @click="addGroup">添加分组</el-button>
              </div>
              <el-table :data="groupList" size="small" v-if="groupList.length > 0">
                <el-table-column label="字段">
                  <template #default="{ row, $index }">
                    <el-select v-model="row.fieldId" placeholder="选择字段" filterable @change="updateGroupItem($index, 'fieldId', row.fieldId)">
                      <el-option 
                        v-for="field in allFields" 
                        :key="field.id" 
                        :label="field.name" 
                        :value="field.id" 
                      />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="80">
                  <template #default="{ $index }">
                    <el-button type="danger" icon="delete-bin-line" circle size="small" @click="removeGroup($index)" />
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="empty-tip">
                尚未添加分组字段
              </div>
            </div>
          </div>
          
          <div class="condition-group">
            <h4>排序设置</h4>
            <div class="group-section">
              <div class="group-header">
                <span>排序字段</span>
                <el-button type="primary" size="small" @click="addOrder">添加排序</el-button>
              </div>
              <el-table :data="orderList" size="small" v-if="orderList.length > 0">
                <el-table-column label="字段">
                  <template #default="{ row, $index }">
                    <el-select v-model="row.fieldId" placeholder="选择字段" filterable @change="updateOrderItem($index, 'fieldId', row.fieldId)">
                      <el-option 
                        v-for="field in allFields" 
                        :key="field.id" 
                        :label="field.name" 
                        :value="field.id" 
                      />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="排序方式">
                  <template #default="{ row, $index }">
                    <el-select v-model="row.orderType" placeholder="选择排序方式" @change="updateOrderItem($index, 'sortDirection', row.orderType)">
                      <el-option
                        v-for="item in orderType"
                        :key="item.code"
                        :label="item.label"
                        :value="item.code"
                      />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="80">
                  <template #default="{ $index }">
                    <el-button type="danger" icon="delete-bin-line" circle size="small" @click="removeOrder($index)" />
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="empty-tip">
                尚未添加排序字段
              </div>
            </div>
          </div>
          
          <div class="condition-group">
            <h4>自定义SQL</h4>
            <div class="sql-helper">
              <p>提示: 可以使用SQL表达式，如CASE WHEN, CONCAT, SUBSTR等</p>
              <p>字段原名将自动替换为实际字段名</p>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
      
      <!-- 拖动调整大小的边界线 -->
      <div class="resizer" @mousedown="startResize"></div>
    </div>
    
    <!-- 右侧Univer表格区域 -->
    <div class="right-panel" :style="{ width: rightPanelWidth }">
      <div class="panel-header">
        <h3>查询结果 <span v-if="lastQueryResult" class="result-count">（{{ lastQueryResult.rowCount }} 行，上限 {{ lastQueryResult.limit }}）</span></h3>
        <el-button-group>
          <el-button size="small" :loading="exporting" @click="exportExcel">导出Excel</el-button>
          <el-button size="small" @click="saveQuery">保存查询</el-button>
        </el-button-group>
      </div>
      <div ref="univerContainer" class="univer-container"></div>
    </div>

    <!-- SQL 预览对话框 -->
    <el-dialog v-model="sqlPreviewVisible" title="SQL 预览" width="720px">
      <template v-if="sqlPreview">
        <el-alert
          v-if="sqlPreview.path && sqlPreview.path.intermediateTableIds && sqlPreview.path.intermediateTableIds.length"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 10px"
          :title="`自动引入了 ${sqlPreview.path.intermediateTableIds.length} 张中间表参与 JOIN`"
        />
        <pre class="sql-preview">{{ sqlPreview.previewSql }}</pre>
      </template>
    </el-dialog>
    
    <!-- 设置别名对话框 -->
    <el-dialog v-model="aliasDialogVisible" title="设置别名" width="30%">
      <el-form :model="currentField" label-width="80px">
        <el-form-item label="字段名">
          <span>{{ currentField.name }}</span>
        </el-form-item>
        <el-form-item label="别名">
          <el-input v-model="currentField.alias" placeholder="请输入别名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="aliasDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAlias">确定</el-button>
      </template>
    </el-dialog>
    
    <!-- 自定义字段设置对话框 -->
    <el-dialog v-model="customizeDialogVisible" title="字段设置" width="50%">
      <el-form :model="currentField" label-width="130px">
        <el-form-item label="字段名">
          <span>{{ currentField.fieldName }}</span>
        </el-form-item>
        <el-form-item label="字段别名">
          <el-input v-model="currentField.alias" :placeholder="currentField.displayName" />
        </el-form-item>

        <el-form-item label="聚合函数">
          <el-select v-model="currentField.functionType" placeholder="请选择聚合函数">
            <el-option label="无" value="" />
            <el-option
              v-for="item in dbFunctionType"
              :key="item.code"
              :label="item.label"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="自定义表达式">
          <el-input 
            v-model="currentField.customSql" 
            type="textarea" 
            :rows="5" 
            placeholder="输入自定义SQL表达式，例如: CASE WHEN age > 18 THEN '成年' ELSE '未成年' END"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="customizeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCustomize">保存设置</el-button>
      </template>
    </el-dialog>
    
    <!-- 查询配置编辑对话框 -->
    <el-dialog v-model="configDialogVisible" :title="configDialogMode === 'add' ? '新建查询配置' : '编辑查询配置'" width="50%">
      <el-form :model="currentConfig" :rules="configRules" ref="configFormRef" label-width="100px">
        <el-form-item label="配置名称" prop="configName">
          <el-input v-model="currentConfig.configName" placeholder="请输入配置名称" maxlength="100" />
        </el-form-item>
        
        <el-form-item label="所属分组" prop="groupId">
          <el-select v-model="currentConfig.groupId" placeholder="选择分组" style="width: 100%">
            <el-option
              v-for="item in tableGroupList"
              :key="item.id"
              :label="item.groupName"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        
        <el-form-item label="配置描述" prop="description">
          <el-input 
            v-model="currentConfig.description" 
            type="textarea" 
            :rows="3" 
            placeholder="请输入配置描述" 
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
        
        <el-form-item label="是否公开" prop="isPublic">
          <el-radio-group v-model="currentConfig.isPublic">
            <el-radio :label="1">公开</el-radio>
            <el-radio :label="0">私有</el-radio>
          </el-radio-group>
          <div class="form-tip">公开的配置其他用户也可以查看和使用</div>
        </el-form-item>
        
        <el-form-item label="排序" prop="orderNum">
          <el-input-number v-model="currentConfig.orderNum" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="configDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveQueryConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
  .sql-preview {
    max-height: 420px;
    padding: 12px;
    overflow: auto;
    font-family: Consolas, Monaco, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: #2d3748;
    word-break: break-all;
    white-space: pre-wrap;
    background: #f5f7fa;
    border-radius: 6px;
  }

  .visual-query-container {
    position: relative;
    display: flex;
    width: 100%;
    height: calc(100vh - 130px);
    overflow: hidden;
    
    .left-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      background-color: var(--el-bg-color);
      border-right: 1px solid var(--el-border-color-light);
      
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 15px;
        border-bottom: 1px solid var(--el-border-color-light);
        
        h3 {
          margin: 0;
        }
      }
      
      .db-selector {
        padding: 10px 15px;
        background-color: var(--el-bg-color-page);
        border-bottom: 1px solid var(--el-border-color-light);
        
        .el-form {
          display: flex;
          flex-wrap: wrap;
          
          .el-form-item {
            margin-right: 10px;
            margin-bottom: 10px;
            
            &:last-child {
              margin-right: 0;
            }
            
            .el-select {
              width: 180px;
            }
          }
        }
      }
      
      .query-config-section {
        padding: 10px 15px;
        background-color: var(--el-bg-color-page);
        border-bottom: 1px solid var(--el-border-color-light);
        
        .config-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 0;
          cursor: pointer;
          
          &:hover {
            background-color: var(--el-fill-color-light);
          }
          
          span {
            font-weight: bold;
          }
        }
        
        .config-content {
          // padding: 10px;
          max-height: 300px;
          overflow-y: auto;
          
          .config-actions {
            margin-bottom: 10px;
            
            .el-button {
              margin-right: 10px;
            }
          }
          
          .config-list {
            max-height: 200px;
            margin-bottom: 10px;
            overflow-y: auto;
            
            .el-table {
              --el-table-header-bg-color: var(--el-fill-color-light);
            }
          }
          
          .form-tip {
            margin-top: 5px;
            font-size: 12px;
            color: var(--el-text-color-secondary);
          }
        }
      }
      
      
      .config-tabs {
        display: flex;
        flex: 1;
        min-height: 0;
        // flex-direction: column;
        padding: 10px;
        
        :deep(.el-tabs__header) {
          flex-shrink: 0;
          margin-bottom: 10px;
        }
        
        :deep(.el-tabs__content) {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }
        
        :deep(.el-tab-pane) {
          height: 100%;
          overflow-y: auto;
        }
        
        .el-input {
          margin-bottom: 10px;
        }
        
        .custom-tree-node {
          display: flex;
          justify-content: space-between;
          width: 100%;
          
          .node-actions {
            display: none;
          }
          
          &:hover .node-actions {
            display: inline-block;
          }
        }

      }
      
      .condition-group {
        margin-bottom: 20px;
        
        h4 {
          margin: 10px 0;
        }
        
        .condition-item {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
          
          .el-select {
            flex: 2;
          }
          
          .el-input {
            flex: 3;
          }
        }
        
        .group-section {
          padding: 10px;
          border: 1px solid var(--el-border-color-light);
          border-radius: 4px;
          
          .group-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
          }
          
          .empty-tip {
            padding: 20px 0;
            color: #999;
            text-align: center;
          }
        }
        
        .sql-helper {
          padding: 10px;
          margin-top: 10px;
          background-color: var(--el-color-info-light-9);
          border-radius: 4px;
          
          p {
            margin: 5px 0;
            font-size: 12px;
            color: var(--el-text-color-secondary);
          }
        }
      }
      
      .resizer {
        position: absolute;
        top: 0;
        right: -5px;
        z-index: 10;
        width: 10px;
        height: 100%;
        cursor: col-resize;
        
        &:hover {
          background-color: rgb(0 0 0 / 10%);
        }
      }
    }
    
    .right-panel {
      display: flex;
      flex-direction: column;
      
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 15px;
        border-bottom: 1px solid var(--el-border-color-light);
        
        h3 {
          margin: 0;

          .result-count {
            font-size: 12px;
            font-weight: normal;
            color: var(--el-text-color-secondary);
          }
        }
      }
      
      .univer-container {
        position: relative;
        flex: 1;
        background-color: #fff;
        
        &:empty::before {
          position: absolute;
          top: 50%;
          left: 50%;
          font-size: 14px;
          color: #999;
          content: "请在左侧选择表和字段，然后点击执行查询按钮";
          transform: translate(-50%, -50%);
        }
      }
    }
  }
</style>