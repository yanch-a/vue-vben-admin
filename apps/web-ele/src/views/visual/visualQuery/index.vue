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

  import { Page } from '@vben/common-ui'

  import { usePreferences } from '@vben/preferences'

  import { deleteQueryConfig, editQueryConfig, executeQueryConfig, exportQueryExcel, getDbConfigList, getGroupTablesWithColumns, getQueryConfigById, getQueryConfigItems, getQueryConfigList, getTableGroupList, getVqDict, listRelationCanvasGroups, previewSqlBySelection, saveQueryItems } from '@/api/visual/vq'
  import { getLatestQueryResultByConfig, saveQueryResultFile, shareQueryResultFile } from '@/api/visual/queryResultFile'
  import { formatSqlByDialect } from '../client/utils/formatSql'
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
    components: { Page },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')
      const { isDark } = usePreferences()
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

      /** 当前会话是否有可保存/分享的执行结果 */
      const hasSessionResult = computed(() => {
        return !!(state.lastQueryResult?.columns?.length && state.lastQueryResult?.rows?.length)
      })

      /**
       * 下拉选项文案：表名.字段名（表别名.字段名）
       * @author yanch
       */
      const buildFieldOptionLabel = (table, field) => {
        const tableName = table?.tableName || table?.displayName || ''
        const fieldName = field?.fieldName || field?.displayName || ''
        const tableAlias = table?.alias || tableName
        return `${tableName}.${fieldName}（${tableAlias}.${fieldName}）`
      }

      /** 条件/分组/排序下拉：仅已勾选字段 */
      const selectedFieldOptions = computed(() => {
        return state.columnList.map((field) => {
          const table = findTableMeta(field.tableId) || field
          return {
            id: field.id,
            name: buildFieldOptionLabel(
              {
                tableName: field.tableName || table.tableName,
                alias: field.tableAlias || table.alias,
                displayName: field.tableDisplayName || table.displayName,
              },
              field,
            ),
          }
        })
      })

      /** 已选字段所属表展示文案 */
      const formatSelectedFieldTable = (field) => {
        const table = findTableMeta(field.tableId) || field
        const tableName = field.tableName || table?.tableName || '未知表'
        const tableDisplay = field.tableDisplayName || table?.displayName || ''
        return tableDisplay && tableDisplay !== tableName ? `${tableName}（${tableDisplay}）` : tableName
      }

      /** 表名着色：同一 tableId 固定颜色，便于区分多表字段 */
      const TABLE_TAG_COLORS = [
        '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
        '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#2ec7c9',
      ]

      const hashTableId = (tableId) => {
        const str = String(tableId ?? '')
        let hash = 0
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i)
          hash |= 0
        }
        return Math.abs(hash)
      }

      const getTableTagStyle = (tableId) => {
        if (tableId == null) {
          return { color: 'var(--el-text-color-regular)' }
        }
        const color = TABLE_TAG_COLORS[hashTableId(tableId) % TABLE_TAG_COLORS.length]
        return { color, fontWeight: 600 }
      }

      /** 根据 tableId 从目录取表元数据 */
      const findTableMeta = (tableId) => {
        return state.dbTables.find((t) => t.id === tableId) || null
      }
      
      /** 左右面板占比 localStorage 键；默认 7:3 */
      const PANEL_RATIO_STORAGE_KEY = 'visualQueryPanelRatioV2'

      // 响应式状态
      const state = reactive({
        // 面板宽度控制（默认左 70% / 右 30%，启动时再从 localStorage 覆盖）
        leftPanelWidth: '70%',
        rightPanelWidth: '30%',
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
        whereList: [],
        
        // 对话框控制
        aliasDialogVisible: false,
        functionDialogVisible: false,
        customizeDialogVisible: false,
        customizeTab: 'basic',
        currentField: {},
        
        // 分组相关
        groupList: [],
        // HAVING 条件
        havingList: [],
        // 排序相关
        orderList: [],
        
        // QueryConfigItem对象列表
        columnItems: [], // 对应COLUMN类型的QueryConfigItem
        whereItems: [],  // 对应WHERE类型的QueryConfigItem
        havingItems: [], // 对应HAVING类型的QueryConfigItem
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
          selectDistinct: 0,
          orderNum: 0,
          /** 选用画布分组；空=全库画布寻路 */
          canvasGroupIds: [],
        },
        /** 当前库下可选画布分组 */
        canvasGroupOptions: [],
        currentConfigItems: null, // 暂存当前查询的字段配置
        selectConfig: null, // 暂存当前查询的数据

        // 真实执行相关
        executing: false,
        exporting: false,
        savingResult: false,
        sharingResult: false,
        loadingLatestResult: false,
        sqlPreviewVisible: false,
        sqlPreview: null,
        lastQueryResult: null,
        /** 最近一次保存的结果文件 ID（分享可复用） */
        lastResultFileId: null,
        shareLinkDialogVisible: false,
        shareLink: '',
        /** 分享前选项 */
        shareFormVisible: false,
        shareForm: {
          shareMode: 'READ',
          shareExpireTime: null,
        },
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

      /**
       * 按当前 columnList 顺序重写 columnItems.orderNum，保证保存顺序与 UI 一致
       * @author yanch
       */
      const syncColumnItemsOrder = () => {
        state.columnItems = state.columnList.map((field, idx) => {
          const existing = state.columnItems.find((item) => item.fieldId === field.id)
          if (existing) {
            return { ...existing, orderNum: idx + 1 }
          }
          return createQueryConfigItem(field, 'COLUMN', { orderNum: idx + 1 })
        })
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
      
      // 处理树节点勾选（保留用户已调整的字段顺序，新勾选追加到末尾）
      const handleCheck = (data, checked) => {
        const { checkedNodes } = checked;
        const selectedMap = new Map()
        checkedNodes.filter(node => node.fieldName).forEach(node => {
          const table = findTableMeta(node.tableId)
          selectedMap.set(node.id, {
            ...node,
            tableName: table?.tableName || node.tableName,
            tableAlias: table?.alias || node.tableAlias,
            tableDisplayName: table?.displayName || node.tableDisplayName,
          })
        })

        const newFieldIds = new Set(selectedMap.keys())
        const keptFields = state.columnList.filter(field => newFieldIds.has(field.id))
        const keptIds = new Set(keptFields.map(field => field.id))

        keptFields.forEach(field => {
          const latest = selectedMap.get(field.id)
          if (latest) {
            field.tableName = latest.tableName
            field.tableAlias = latest.tableAlias
            field.tableDisplayName = latest.tableDisplayName
          }
        })

        selectedMap.forEach((field, fieldId) => {
          if (!keptIds.has(fieldId)) {
            keptFields.push(field)
            syncFieldToColumnItems(field, 'add')
          }
        })

        state.columnList.filter(field => !newFieldIds.has(field.id)).forEach(field => {
          syncFieldToColumnItems(field, 'remove')
          purgeFieldFromConditions(field.id)
        })

        state.columnList = keptFields
        syncColumnItemsOrder()
      };

      /** 取消勾选字段时，同步清理条件/分组/排序/HAVING 中的引用 */
      const purgeFieldFromConditions = (fieldId) => {
        for (let i = state.whereList.length - 1; i >= 0; i--) {
          if (state.whereList[i].field === fieldId) {
            removeCondition(i)
          }
        }
        for (let i = state.havingList.length - 1; i >= 0; i--) {
          if (state.havingList[i].field === fieldId) {
            removeHaving(i)
          }
        }
        for (let i = state.groupList.length - 1; i >= 0; i--) {
          if (state.groupList[i].fieldId === fieldId) {
            removeGroup(i)
          }
        }
        for (let i = state.orderList.length - 1; i >= 0; i--) {
          if (state.orderList[i].fieldId === fieldId) {
            removeOrder(i)
          }
        }
      }
      
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
      
      /** 上移字段（在扁平 columnList 上移动，支持跨表交叉排序） */
      const moveFieldUp = (index) => {
        if (index > 0) {
          const temp = state.columnList[index];
          state.columnList.splice(index, 1);
          state.columnList.splice(index - 1, 0, temp);
          syncColumnItemsOrder()
        }
      };
      
      // 下移字段
      const moveFieldDown = (index) => {
        if (index >= 0 && index < state.columnList.length - 1) {
          const temp = state.columnList[index];
          state.columnList.splice(index, 1);
          state.columnList.splice(index + 1, 0, temp);
          syncColumnItemsOrder()
        }
      };

      /** 将字段移动到指定序号（1-based） */
      const moveFieldToOrder = (fromIndex, targetOrder) => {
        if (targetOrder == null || targetOrder === '') {
          return
        }
        const toIndex = Math.max(0, Math.min(state.columnList.length - 1, Number(targetOrder) - 1))
        if (fromIndex === toIndex || Number.isNaN(toIndex)) {
          return
        }
        const [field] = state.columnList.splice(fromIndex, 1)
        state.columnList.splice(toIndex, 0, field)
        syncColumnItemsOrder()
      }
      
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
      
      // 添加查询条件（运算符必须用枚举名 EQ，不能传 "="）
      const addCondition = () => {
        const condition = {
          field: '',
          operator: 'EQ',
          value: ''
        }
        state.whereList.push(condition);
        
        // 同步到whereItems
        const whereItem = createQueryConfigItem({ id: null }, 'WHERE', { 
          conditionOperator: 'EQ',
          conditionValue: '',
          orderNum: state.whereItems.length + 1 
        })
        state.whereItems.push(whereItem)
      };

      /** 运算符是否需要填写条件值 */
      const operatorNeedsValue = (op) => {
        return op !== 'IS_NULL' && op !== 'IS_NOT_NULL'
      }

      /** 条件值占位提示 */
      const conditionValuePlaceholder = (op) => {
        if (op === 'BETWEEN') return '最小值,最大值'
        if (op === 'IN' || op === 'NOT_IN') return '值1,值2,值3'
        if (op === 'Like' || op === 'NOT_LIKE') return '关键字（自动加%）'
        return '值'
      }
      
      // 添加 HAVING 条件
      const addHaving = () => {
        state.havingList.push({ field: '', operator: 'EQ', value: '' })
        state.havingItems.push(createQueryConfigItem({ id: null }, 'HAVING', {
          conditionOperator: 'EQ',
          conditionValue: '',
          orderNum: state.havingItems.length + 1,
        }))
      }

      const removeHaving = (index) => {
        state.havingList.splice(index, 1)
        state.havingItems.splice(index, 1)
        state.havingItems.forEach((item, idx) => {
          item.orderNum = idx + 1
        })
      }

      const updateHavingItem = (index, property, value) => {
        if (state.havingItems[index]) {
          state.havingItems[index][property] = value
        }
      }
      
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
      
      // 保存查询配置项前规范化（与后端枚举一致）
      const normalizeConfigItemForApi = (item) => {
        const copy = { ...item }
        if (copy.conditionOperator === '') {
          copy.conditionOperator = null
        }
        if (copy.conditionOperator === '=') copy.conditionOperator = 'EQ'
        if (copy.conditionOperator === '!=' || copy.conditionOperator === '<>') copy.conditionOperator = 'NEQ'
        if (copy.conditionOperator === '>') copy.conditionOperator = 'GT'
        if (copy.conditionOperator === '>=') copy.conditionOperator = 'GTE'
        if (copy.conditionOperator === '<') copy.conditionOperator = 'LT'
        if (copy.conditionOperator === '<=') copy.conditionOperator = 'LTE'
        if (copy.conditionOperator === 'LIKE') copy.conditionOperator = 'Like'
        if (copy.functionType === '') {
          copy.functionType = null
        }
        return copy
      }

      /** 组装 SQL 预览/保存用的配置项 */
      const buildDraftConfigItems = () => {
        syncColumnItemsOrder()
        return [
          ...state.columnItems,
          ...state.whereItems,
          ...state.havingItems,
          ...state.groupItems,
          ...state.orderItems,
        ].map(normalizeConfigItemForApi)
      }

      /** 组装 SQL 预览请求体（始终反映当前界面配置） */
      const buildPreviewPayload = () => ({
        dbConfigId: state.currentDbConfig,
        groupId: state.currentTableGroup || undefined,
        selectDistinct: state.currentConfig.selectDistinct ? 1 : 0,
        canvasGroupIds: state.currentConfig.canvasGroupIds?.length
          ? state.currentConfig.canvasGroupIds
          : undefined,
        items: buildDraftConfigItems(),
        configId: state.currentConfig?.id || undefined,
      })
      const ensureConfigSaved = () => {
        if (!state.currentConfig || !state.currentConfig.id) {
          $baseMessage('请先保存查询配置（新建配置并保存字段项），再执行查询', 'warning');
          return false;
        }
        return true;
      };

      // 提取接口错误文案（utils/request 用 responseReturn:body 时不会走全局 ElMessage）
      const getRequestErrorMessage = (error, fallback) =>
        error?.msg || error?.message || fallback

      // 执行查询（调后端 /queryExecute/execute）
      const executeQuery = async () => {
        if (!ensureConfigSaved()) return;
        state.executing = true;
        try {
          const { data } = await executeQueryConfig(state.currentConfig.id);
          state.lastQueryResult = data;
          state.lastResultFileId = null;
          // 空结果：只提示，不渲染表格（避免 Univer 报「渲染失败」）
          if (!data?.rows?.length) {
            clearUniverSheet();
            $baseMessage('查询成功，但没有数据', 'warning');
            return;
          }
          renderUniver(data.columns || [], data.rows || []);
          if (data.path?.intermediateTableIds?.length) {
            $baseMessage(`已自动引入 ${data.path.intermediateTableIds.length} 张中间表完成关联`, 'info');
          }
        } catch (error) {
          console.error('执行查询失败:', error);
          $baseMessage(getRequestErrorMessage(error, '执行查询失败'), 'error');
        } finally {
          state.executing = false;
        }
      };

      // SQL 预览：按当前界面配置即时生成（含 WHERE/GROUP/HAVING/ORDER/DISTINCT）
      const previewSql = async () => {
        try {
          if (!state.currentDbConfig) {
            $baseMessage('请先选择数据库', 'warning')
            return
          }
          if (!state.columnList.length) {
            $baseMessage('请先勾选要查询的字段，再预览 SQL', 'warning')
            return
          }
          const res = await previewSqlBySelection(buildPreviewPayload())
          let data = res.data
          if (data) {
            data.previewSql = formatPreviewSql(data.previewSql, data.dbType)
            if (data.lastExecutedSql) {
              data.lastExecutedSql = formatPreviewSql(data.lastExecutedSql, data.dbType)
            }
          }
          state.sqlPreview = data
          state.sqlPreviewVisible = true
        } catch (error) {
          console.error('SQL预览失败:', error)
          $baseMessage(getRequestErrorMessage(error, 'SQL 预览失败'), 'error')
        }
      }

      /**
       * 预览 SQL：按方言格式化，并去掉反引号（用户可读性优先）
       * @author yanch
       */
      const formatPreviewSql = (sql, dbType) => {
        if (!sql) return sql
        let out = sql
        try {
          out = formatSqlByDialect(sql, dbType)
        } catch (e) {
          console.warn('SQL 格式化失败，使用原文', e)
        }
        // 明确去掉反引号，不引入该符号
        return String(out).replace(/`/g, '')
      }
      
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
            darkMode: !!isDark.value,
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

      // 主题切换时同步 Univer 暗色模式
      watch(isDark, (dark) => {
        try {
          univerAPI?.toggleDarkMode?.(!!dark);
        } catch (e) {
          console.warn('切换 Univer 主题失败:', e);
        }
      });
      
      // 上次渲染的区域大小（用于覆盖清空）
      let lastRenderRows = 0;
      let lastRenderCols = 0;

      /** 清空结果区表格内容（不销毁实例） */
      const clearUniverSheet = () => {
        try {
          if (!univerAPI || lastRenderRows <= 0 || lastRenderCols <= 0) {
            lastRenderRows = 0;
            lastRenderCols = 0;
            return;
          }
          const workbook = univerAPI.getActiveWorkbook();
          const sheet = workbook?.getActiveSheet();
          if (!sheet) return;
          const emptyValues = Array.from({ length: lastRenderRows }, () =>
            Array.from({ length: lastRenderCols }, () => null),
          );
          sheet.getRange(0, 0, lastRenderRows, lastRenderCols).setValues(emptyValues);
        } catch (e) {
          console.warn('清空结果表格失败:', e);
        } finally {
          lastRenderRows = 0;
          lastRenderCols = 0;
        }
      };

      /** 切换配置时重置右侧本次会话结果（不自动加载历史保存文件） */
      const resetResultPanel = () => {
        state.lastQueryResult = null;
        state.lastResultFileId = null;
        clearUniverSheet();
      };

      // 将数据渲染到Univer（columns: 列标签数组，rows: 行对象数组）
      const renderUniver = (columns, rows, options = {}) => {
        try {
          if (!columns?.length || !rows?.length) {
            clearUniverSheet();
            return;
          }
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
          if (!options.silent) {
            $baseMessage(`数据加载成功，共 ${rows.length} 行`, 'success');
          }
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
      
      /**
       * 将当前查询结果保存为服务器文件（不再等同于保存配置）
       * @author yanch
       */
      const saveQuery = async () => {
        if (!hasSessionResult.value) {
          $baseMessage('请先执行查询并得到结果，再保存结果文件', 'warning');
          return;
        }
        state.savingResult = true;
        try {
          const title = state.currentConfig?.configName
            ? `${state.currentConfig.configName}-结果`
            : '查询结果';
          const { data, msg } = await saveQueryResultFile({
            configId: state.currentConfig?.id,
            title,
            columns: state.lastQueryResult.columns,
            rows: state.lastQueryResult.rows || [],
          });
          state.lastResultFileId = data?.id || null;
          $baseMessage(msg || '结果已保存到服务器', 'success');
        } catch (error) {
          console.error('保存结果文件失败:', error);
          $baseMessage(getRequestErrorMessage(error, '保存结果失败'), 'error');
        } finally {
          state.savingResult = false;
        }
      };

      /**
       * 显式打开当前配置「最近一次保存」的结果（切换配置不会自动加载）
       * @author yanch
       */
      const openLatestSavedResult = async () => {
        if (!state.currentConfig?.id) {
          $baseMessage('请先选择或保存查询配置', 'warning');
          return;
        }
        state.loadingLatestResult = true;
        try {
          const { data } = await getLatestQueryResultByConfig(state.currentConfig.id);
          if (!data?.meta?.id) {
            $baseMessage('该配置还没有保存过结果，请先执行查询并点击「保存结果」', 'info');
            return;
          }
          const columns = data.columns || [];
          const rows = data.rows || [];
          state.lastResultFileId = data.meta.id;
          state.lastQueryResult = {
            columns,
            rows,
            rowCount: data.meta.rowCount ?? rows.length,
            limit: rows.length,
          };
          if (!rows.length) {
            clearUniverSheet();
            $baseMessage('已打开最近保存结果，但内容为空', 'warning');
            return;
          }
          renderUniver(columns, rows, { silent: true });
          $baseMessage(`已打开最近保存结果「${data.meta.title || ''}」（${rows.length} 行）`, 'success');
        } catch (error) {
          console.error('打开最近保存结果失败:', error);
          $baseMessage(getRequestErrorMessage(error, '打开最近保存结果失败'), 'error');
        } finally {
          state.loadingLatestResult = false;
        }
      };

      /**
       * 打开分享选项（模式/过期），确认后再真正分享
       * @author yanch
       */
      const openShareForm = () => {
        if (!hasSessionResult.value && !state.lastResultFileId) {
          $baseMessage('请先执行查询并保存结果，或先打开最近保存结果后再分享', 'warning');
          return;
        }
        state.shareForm = { shareMode: 'READ', shareExpireTime: null };
        state.shareFormVisible = true;
      };

      const shareQueryResult = async () => {
        state.sharingResult = true;
        try {
          const title = state.currentConfig?.configName
            ? `${state.currentConfig.configName}-分享`
            : '查询结果分享';
          const payload = {
            resultFileId: state.lastResultFileId || undefined,
            configId: state.currentConfig?.id,
            title,
            shareMode: state.shareForm.shareMode || 'READ',
            shareExpireTime: state.shareForm.shareExpireTime || null,
          };
          if (state.lastQueryResult?.columns?.length) {
            payload.columns = state.lastQueryResult.columns;
            payload.rows = state.lastQueryResult.rows || [];
          }
          const { data } = await shareQueryResultFile(payload);
          if (data?.meta?.id) {
            state.lastResultFileId = data.meta.id;
          }
          const path = data?.shareUrl || (data?.meta?.shareCode
            ? `/visual/queryResult/share/${data.meta.shareCode}`
            : '');
          if (!path) {
            $baseMessage('生成分享链接失败', 'error');
            return;
          }
          state.shareFormVisible = false;
          state.shareLink = `${window.location.origin}${path}`;
          state.shareLinkDialogVisible = true;
        } catch (error) {
          console.error('分享失败:', error);
          $baseMessage('分享失败', 'error');
        } finally {
          state.sharingResult = false;
        }
      };

      const copyShareLink = async () => {
        try {
          await navigator.clipboard.writeText(state.shareLink);
          $baseMessage('链接已复制', 'success');
        } catch {
          $baseMessage('复制失败，请手动选择链接', 'warning');
        }
      };
      
      // === 查询配置相关方法 ===
      
      // 切换配置区域显示/隐藏
      const toggleConfigVisible = () => {
        state.configVisible = !state.configVisible
        // 保存状态到localStorage
        localStorage.setItem('queryConfigVisible', state.configVisible)
      }
      
      // 显示配置对话框
      const showConfigDialog = async (mode, config = null) => {
        state.configDialogMode = mode
        
        if (mode === 'add') {
          state.currentConfig = {
            id: null,
            configName: '',
            groupId: state.currentTableGroup || null,
            description: '',
            isPublic: 0,
            selectDistinct: 0,
            orderNum: 0,
            canvasGroupIds: [],
          }
        } else if (mode === 'edit' && config) {
          // 详情带上 canvasGroupIds
          if (config.id) {
            try {
              const { data } = await getQueryConfigById({ id: config.id })
              state.currentConfig = {
                ...config,
                ...(data || {}),
                canvasGroupIds: data?.canvasGroupIds || [],
              }
            } catch {
              state.currentConfig = { ...config, canvasGroupIds: config.canvasGroupIds || [] }
            }
          } else {
            state.currentConfig = { ...config, canvasGroupIds: [] }
          }
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
          $baseMessage(getRequestErrorMessage(error, '保存配置失败'), 'error')
        }
      }

      // 保存查询配置项
      const saveQueryConfigItems = async () => {
        if (!state.currentConfig.id) {
          // 新数据，打开新增配置对话框
          showConfigDialog('add')
          return
        }
        try {
          const configData = buildDraftConfigItems()

          // 同步 DISTINCT 开关到配置主表
          if (state.currentConfig.id) {
            try {
              await editQueryConfig({
                ...state.currentConfig,
                selectDistinct: state.currentConfig.selectDistinct ? 1 : 0,
              })
            } catch (e) {
              console.warn('更新 DISTINCT 开关失败（字段项仍会保存）:', e)
            }
          }

          const { msg } = await saveQueryItems(state.currentConfig.id, configData)
          $baseMessage(msg, 'success')
          // 清空暂存的items
          // state.currentConfigItems = null
          
        } catch (error) {
          console.error('保存查询配置失败:', error)
          $baseMessage(getRequestErrorMessage(error, '保存配置失败'), 'error')
        }
      }
      
      // 选择查询配置
      const selectQueryConfig = async (config) => {
        state.selectConfig = config
        // 后续执行/预览/导出/保存字段项都基于该配置
        state.currentConfig = {
          ...config,
          selectDistinct: config.selectDistinct ? 1 : 0,
        }
        try {
          // 调用后端API获取完整的配置信息
          const { data } = await getQueryConfigItems(config.id)
          const fullConfigVo = data
          
          // 切换到对应的分组
          if (config.groupId !== state.currentTableGroup) {
            state.currentTableGroup = config.groupId
            await handleGroupChange(config.groupId)
          }
          
          // 等待数据加载完成后再进行回显
          await nextTick()
          
          // 清空当前所有选择和配置
          clearAllSelections()
          // 切换配置只加载「查询定义」，不自动带回上次会话/保存结果
          resetResultPanel()
          
          // 回显数据
          await restoreFromConfigVo(fullConfigVo)
          
          $baseMessage(`已加载配置「${config.configName}」。右侧结果已清空，请重新执行查询；如需历史结果请点「打开最近保存结果」`, 'success')
          
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
        state.havingList = []
        state.groupList = []
        state.orderList = []
        
        // 清空所有items
        state.columnItems = []
        state.whereItems = []
        state.havingItems = []
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

        // 恢复 HAVING
        if (configVo.havingItems && configVo.havingItems.length > 0) {
          restoreHavingItems(configVo.havingItems)
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
            
            // 添加到选中字段列表（补齐表元数据，供树表父级展示）
            const table = findTableMeta(fieldNode.tableId)
            state.columnList.push({
              ...fieldNode,
              alias: item.alias || '',
              functionType: item.functionType,
              customSql: item.customSql || '',
              tableName: table?.tableName || fieldNode.tableName,
              tableAlias: table?.alias || fieldNode.tableAlias,
              tableDisplayName: table?.displayName || fieldNode.tableDisplayName,
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
          operator: normalizeOperator(item.conditionOperator),
          value: item.conditionValue || ''
        }))
        
        state.whereItems = sortedItems.map(item => ({
          ...item,
          conditionOperator: normalizeOperator(item.conditionOperator),
        }))
      }

      /** 把历史符号运算符规范为枚举名 */
      const normalizeOperator = (op) => {
        if (!op) return 'EQ'
        const map = {
          '=': 'EQ', '==': 'EQ',
          '!=': 'NEQ', '<>': 'NEQ',
          '>': 'GT', '>=': 'GTE',
          '<': 'LT', '<=': 'LTE',
          LIKE: 'Like',
        }
        return map[op] || op
      }

      const restoreHavingItems = (havingItems) => {
        const sortedItems = [...havingItems].sort((a, b) => a.orderNum - b.orderNum)
        state.havingList = sortedItems.map(item => ({
          field: item.fieldId,
          operator: normalizeOperator(item.conditionOperator),
          value: item.conditionValue || '',
        }))
        state.havingItems = sortedItems.map(item => ({
          ...item,
          conditionOperator: normalizeOperator(item.conditionOperator),
        }))
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
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
      };
      
      // 处理面板大小调整
      const handleResize = (e) => {
        if (!state.isResizing) return;
        
        // 获取容器相对于视口的位置信息
        const container = document.querySelector('.visual-query-container');
        if (!container) return;
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
      
      /**
       * 停止拖拽：持久化占比，并触发表格重算宽度（解决左侧 table 不随容器伸缩）
       * @author yanch
       */
      const stopResize = () => {
        state.isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', stopResize);
        try {
          const leftPct = parseFloat(state.leftPanelWidth)
          if (!Number.isNaN(leftPct)) {
            localStorage.setItem(PANEL_RATIO_STORAGE_KEY, String(leftPct))
          }
        } catch (e) {
          console.warn('保存面板占比失败:', e)
        }
        // 下一帧触发布局重算，让 el-table 跟随父容器宽度
        nextTick(() => {
          window.dispatchEvent(new Event('resize'))
        })
      };

      /** 从 localStorage 恢复左右面板占比，缺省 70:30 */
      const restorePanelRatio = () => {
        try {
          const saved = localStorage.getItem(PANEL_RATIO_STORAGE_KEY)
          if (saved != null) {
            const leftPct = Math.max(10, Math.min(80, parseFloat(saved)))
            if (!Number.isNaN(leftPct)) {
              state.leftPanelWidth = `${leftPct}%`
              state.rightPanelWidth = `${100 - leftPct}%`
              return
            }
          }
        } catch (e) {
          console.warn('读取面板占比失败:', e)
        }
        state.leftPanelWidth = '70%'
        state.rightPanelWidth = '30%'
      }

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
        state.columnList = []
        state.canvasGroupOptions = []
        resetResultPanel()
        
        // 加载新选择的数据库的表分组与画布分组
        await loadTableGroupList(dbConfigId)
        try {
          const { data } = await listRelationCanvasGroups(dbConfigId)
          state.canvasGroupOptions = data || []
        } catch (e) {
          console.warn('加载画布分组失败', e)
        }
      }
      
      // 处理分组变更
      const handleGroupChange = async (groupId) => {
        state.dbTables = []
        state.columnList = []
        resetResultPanel()
        
        // 加载新选择的分组的表和字段
        await loadTablesWithColumns(state.currentDbConfig, groupId)
        
        // 加载该分组的查询配置列表
        await loadQueryConfigList()
      }
      
      // 初始化
      onMounted(() => {
        // 从 localStorage 恢复左右占比（默认 1:1）与配置区折叠状态
        restorePanelRatio()
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
        hasSessionResult,
        selectedFieldOptions,
        formatSelectedFieldTable,
        getTableTagStyle,
        filterNode,
        handleCheck,
        setAlias,
        saveAlias,
        customizeField,
        saveCustomize,
        moveFieldUp,
        moveFieldDown,
        moveFieldToOrder,
        addGroup,
        removeGroup,
        addOrder,
        removeOrder,
        addCondition,
        removeCondition,
        operatorNeedsValue,
        conditionValuePlaceholder,
        addHaving,
        removeHaving,
        updateHavingItem,
        updateWhereItem,
        updateGroupItem,
        updateOrderItem,
        executeQuery,
        previewSql,
        exportExcel,
        saveQuery,
        openLatestSavedResult,
        openShareForm,
        shareQueryResult,
        copyShareLink,
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
  <Page auto-content-height content-class="!p-0">
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
              <el-checkbox
                v-model="currentConfig.selectDistinct"
                :true-value="1"
                :false-value="0"
                style="margin-left: 12px"
              >
                SELECT DISTINCT
              </el-checkbox>
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
                <span v-if="data.tableName">
                  {{ data.tableName }}
                  <el-tag v-if="data.schemaName" size="small" type="info" style="margin-left: 4px;">
                    {{ data.schemaName }}
                  </el-tag>
                  <span v-if="data.displayName && data.displayName !== data.tableName" class="node-comment">
                    ({{ data.displayName }})
                  </span>
                </span>
                <span v-else>{{ `${data.fieldName }  (${ data.displayName })` }}</span>
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
            <p class="hint-text">「排序」列可直接输入目标序号；字段顺序即 SELECT 输出顺序，可跨表自由调整。</p>
            <el-table
              :data="columnList"
              size="small"
              row-key="id"
              class="selected-fields-table"
            >
              <el-table-column label="排序" width="96" align="center">
                <template #default="{ $index }">
                  <el-input-number
                    :model-value="$index + 1"
                    :min="1"
                    :max="columnList.length"
                    :controls="true"
                    size="small"
                    controls-position="right"
                    class="field-order-input"
                    @change="(val) => moveFieldToOrder($index, val)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="表" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">
                  <span :style="getTableTagStyle(row.tableId)">{{ formatSelectedFieldTable(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="字段" prop="fieldName" min-width="100" show-overflow-tooltip />
              <el-table-column label="名称" prop="displayName" min-width="120" show-overflow-tooltip />
              <el-table-column label="操作" width="140">
                <template #default="{ row, $index }">
                  <el-button-group>
                    <el-button link size="small" @click="moveFieldUp($index)" :disabled="$index === 0">
                      <vab-icon icon="arrow-up-line" />
                    </el-button>
                    <el-button link size="small" @click="moveFieldDown($index)" :disabled="$index >= columnList.length - 1">
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
            <div class="group-header condition-title-row">
              <h4>查询条件</h4>
              <el-button type="primary" size="small" @click="addCondition">添加条件</el-button>
            </div>
            <div v-for="(condition, index) in whereList" :key="index" class="condition-item">
              <el-select v-model="condition.field" placeholder="选择字段" filterable @change="updateWhereItem(index, 'fieldId', condition.field)">
                <el-option 
                  v-for="field in selectedFieldOptions" 
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
              <el-input
                v-if="operatorNeedsValue(condition.operator)"
                v-model="condition.value"
                :placeholder="conditionValuePlaceholder(condition.operator)"
                @input="updateWhereItem(index, 'conditionValue', condition.value)"
              />
              <el-button type="danger" icon="delete-bin-line" circle @click="removeCondition(index)" />
            </div>
          </div>

          <div class="condition-group">
            <div class="group-header condition-title-row">
              <h4>HAVING 条件</h4>
              <el-button type="primary" size="small" @click="addHaving">添加 HAVING</el-button>
            </div>
            <p class="hint-text">用于聚合后过滤；通常需先配置分组字段。IN/BETWEEN 多个值用英文逗号分隔。</p>
            <div v-for="(condition, index) in havingList" :key="'h'+index" class="condition-item">
              <el-select v-model="condition.field" placeholder="选择字段" filterable @change="updateHavingItem(index, 'fieldId', condition.field)">
                <el-option
                  v-for="field in selectedFieldOptions"
                  :key="field.id"
                  :label="field.name"
                  :value="field.id"
                />
              </el-select>
              <el-select v-model="condition.operator" placeholder="条件" @change="updateHavingItem(index, 'conditionOperator', condition.operator)">
                <el-option
                  v-for="item in conditionOperator"
                  :key="item.code"
                  :label="item.label"
                  :value="item.code"
                />
              </el-select>
              <el-input
                v-if="operatorNeedsValue(condition.operator)"
                v-model="condition.value"
                :placeholder="conditionValuePlaceholder(condition.operator)"
                @input="updateHavingItem(index, 'conditionValue', condition.value)"
              />
              <el-button type="danger" icon="delete-bin-line" circle @click="removeHaving(index)" />
            </div>
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
                        v-for="field in selectedFieldOptions" 
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
                        v-for="field in selectedFieldOptions" 
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
        <h3>
          查询结果
          <span v-if="lastQueryResult" class="result-count">
            （{{ lastQueryResult.rowCount }} 行<span v-if="lastQueryResult.limit">，上限 {{ lastQueryResult.limit }}</span>）
          </span>
        </h3>
        <el-button-group>
          <el-button
            size="small"
            :loading="loadingLatestResult"
            :disabled="!currentConfig?.id"
            @click="openLatestSavedResult"
          >
            打开最近保存结果
          </el-button>
          <el-button size="small" :loading="exporting" :disabled="!currentConfig?.id" @click="exportExcel">
            导出Excel
          </el-button>
          <el-button size="small" :loading="savingResult" :disabled="!hasSessionResult" @click="saveQuery">
            保存结果
          </el-button>
          <el-button
            size="small"
            type="success"
            :loading="sharingResult"
            :disabled="!hasSessionResult && !lastResultFileId"
            @click="openShareForm"
          >
            分享
          </el-button>
        </el-button-group>
      </div>
      <div ref="univerContainer" class="univer-container"></div>
    </div>

    <!-- SQL 预览对话框（含与上次执行对比） -->
    <el-dialog v-model="sqlPreviewVisible" title="SQL 预览" width="900px">
      <template v-if="sqlPreview">
        <el-alert
          v-if="sqlPreview.dialectHint"
          type="success"
          :closable="false"
          show-icon
          style="margin-bottom: 10px"
          :title="`按目标库方言生成：${sqlPreview.dbType || '-'} / ${sqlPreview.dialectFamily || '-'}`"
          :description="sqlPreview.dialectHint"
        />
        <el-alert
          v-if="sqlPreview.path && sqlPreview.path.intermediateTableIds && sqlPreview.path.intermediateTableIds.length"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 10px"
          :title="`自动引入了 ${sqlPreview.path.intermediateTableIds.length} 张中间表参与 JOIN`"
        />
        <el-alert
          v-if="sqlPreview.sqlChanged === true && sqlPreview.lastExecutedSql"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 10px"
          title="当前预览 SQL 与上次执行不一致"
          :description="sqlPreview.lastExecutedTime ? `上次执行时间：${sqlPreview.lastExecutedTime}` : ''"
        />
        <el-alert
          v-else-if="sqlPreview.sqlChanged === false"
          type="success"
          :closable="false"
          show-icon
          style="margin-bottom: 10px"
          title="与上次执行 SQL 一致"
        />
        <el-row :gutter="12">
          <el-col :span="sqlPreview.lastExecutedSql ? 12 : 24">
            <div class="sql-pane-title">当前预览</div>
            <pre class="sql-preview">{{ sqlPreview.previewSql }}</pre>
          </el-col>
          <el-col v-if="sqlPreview.lastExecutedSql" :span="12">
            <div class="sql-pane-title">上次执行</div>
            <pre class="sql-preview">{{ sqlPreview.lastExecutedSql }}</pre>
          </el-col>
        </el-row>
      </template>
    </el-dialog>

    <!-- 分享选项 -->
    <el-dialog v-model="shareFormVisible" title="分享设置" width="480px">
      <el-form label-width="100px">
        <el-form-item label="权限模式">
          <el-radio-group v-model="shareForm.shareMode">
            <el-radio label="READ">只读</el-radio>
            <el-radio label="WRITE">可编辑</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="shareForm.shareExpireTime"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="不选则不过期"
            clearable
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shareFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="sharingResult" @click="shareQueryResult">生成链接</el-button>
      </template>
    </el-dialog>

    <!-- 分享链接对话框 -->
    <el-dialog v-model="shareLinkDialogVisible" title="分享链接" width="560px">
      <p style="margin-bottom: 8px; color: var(--el-text-color-secondary); font-size: 13px;">
        对方需登录后打开。只读分享不可改内容；可编辑分享允许协同修改（乐观锁）。
      </p>
      <el-input v-model="shareLink" readonly>
        <template #append>
          <el-button @click="copyShareLink">复制</el-button>
        </template>
      </el-input>
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
        
        <el-form-item label="寻路画布">
          <el-select
            v-model="currentConfig.canvasGroupIds"
            multiple
            clearable
            filterable
            placeholder="不选则使用该库全部画布"
            style="width: 100%"
          >
            <el-option
              v-for="item in canvasGroupOptions"
              :key="item.id"
              :label="item.groupName"
              :value="item.id"
            />
          </el-select>
          <div class="form-tip">可多选；空=全库画布并集寻路</div>
        </el-form-item>

        <el-form-item label="是否公开" prop="isPublic">
          <el-radio-group v-model="currentConfig.isPublic">
            <el-radio :label="1">公开</el-radio>
            <el-radio :label="0">私有</el-radio>
          </el-radio-group>
          <div class="form-tip">公开的配置其他用户也可以查看和使用</div>
        </el-form-item>

        <el-form-item label="去重">
          <el-switch
            v-model="currentConfig.selectDistinct"
            :active-value="1"
            :inactive-value="0"
            active-text="SELECT DISTINCT"
          />
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
  </Page>
</template>

<style lang="scss" scoped>
  .sql-preview {
    max-height: 420px;
    padding: 12px;
    overflow: auto;
    font-family: Consolas, Monaco, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-primary);
    word-break: break-all;
    white-space: pre-wrap;
    background: var(--el-fill-color-light);
    border: 1px solid var(--el-border-color-light);
    border-radius: 6px;
  }

  .sql-pane-title {
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .visual-query-container {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    
    .left-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      // 允许 flex 子项在百分比宽度变化时收缩，否则表格会锁死旧宽度
      min-width: 0;
      overflow: hidden;
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
        // 保证拖拽改宽后，内部表格随容器伸缩
        overflow-x: hidden;
        
        h4 {
          margin: 10px 0;
        }

        .condition-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;

          h4 {
            margin: 0;
          }
        }

        .hint-text {
          margin: 0 0 10px;
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }

        .selected-fields-table {
          width: 100%;

          .field-order-input {
            width: 72px;
          }

          :deep(.field-order-input .el-input__wrapper) {
            padding-left: 4px;
            padding-right: 24px;
          }

          :deep(.el-table__body),
          :deep(.el-table__header) {
            width: 100% !important;
          }
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
      min-width: 0;
      background-color: var(--el-bg-color);
      
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 15px;
        background-color: var(--el-bg-color);
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
        background-color: var(--el-bg-color);
        
        &:empty::before {
          position: absolute;
          top: 50%;
          left: 50%;
          font-size: 14px;
          color: var(--el-text-color-secondary);
          content: "执行查询后显示结果；切换配置不会自动加载历史结果";
          transform: translate(-50%, -50%);
        }
      }
    }
  }
</style>