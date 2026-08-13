<script setup name="MemberUserSelect">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { searchMemberUser } from "@/api/member/memberUser"

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: ''
  },
  placeholder: {
    type: String,
    default: '请选择会员用户'
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const containerRef = ref()
const searchInputRef = ref()
const isOpen = ref(false)
const selectedMemberUserId = ref(props.modelValue)
const selectedMemberUser = ref(null)
const memberUserList = ref([])
const loading = ref(false)
const searchKeyword = ref('')

// 根据ID加载会员用户信息（用于回显）
const loadMemberUserById = (memberUserId) => {
  if (!memberUserId) return
  
  loading.value = true
  const params = {
    pageNum: 1,
    pageSize: 1,
    id: memberUserId
  }
  
  searchMemberUser(params).then(response => {
    if (response && response.data && response.data.length > 0) {
      selectedMemberUser.value = response.data[0]
    }
    loading.value = false
  }).catch(() => {
    loading.value = false
  })
}

// 监听外部值变化
watch(() => props.modelValue, (newVal) => {
  selectedMemberUserId.value = newVal
  if (newVal && !selectedMemberUser.value) {
    // 如果有值但没有会员用户信息，需要根据ID获取会员用户信息
    loadMemberUserById(newVal)
  }
}, { immediate: true })

// 切换下拉菜单
const toggleDropdown = () => {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    nextTick(() => {
      searchInputRef.value?.focus()
    })
  }
}

// 点击外部关闭下拉菜单
const handleClickOutside = (event) => {
  if (containerRef.value && !containerRef.value.contains(event.target)) {
    isOpen.value = false
  }
}

// 搜索会员用户
const handleSearch = () => {
  if (!searchKeyword.value.trim()) {
    memberUserList.value = []
    return
  }
  
  loading.value = true
  const params = {
    pageNum: 1,
    pageSize: 20,
    userName: searchKeyword.value,
    realName: searchKeyword.value
  }
  
  searchMemberUser(params).then(response => {
    if (response && response.data) {
      memberUserList.value = response.data
    } else {
      memberUserList.value = []
    }
    loading.value = false
  }).catch(() => {
    memberUserList.value = []
    loading.value = false
  })
}

// 清空搜索
const handleClear = () => {
  searchKeyword.value = ''
  memberUserList.value = []
}

// 选择会员用户
const selectMemberUser = (user) => {
  selectedMemberUserId.value = user.id
  selectedMemberUser.value = user
  emit('update:modelValue', user.id)
  emit('change', user)
  isOpen.value = false
}

// 组件挂载时，如果有初始值，加载会员用户信息
onMounted(() => {
  if (props.modelValue) {
    loadMemberUserById(props.modelValue)
  }
  
  // 添加点击外部关闭事件
  document.addEventListener('click', handleClickOutside)
})

// 组件卸载时移除事件监听
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="member-user-select-container" ref="containerRef">
    <!-- 选择框显示区域 -->
    <div 
      class="member-user-select-trigger" 
      :class="{ 'is-focused': isOpen }"
      @click="toggleDropdown"
    >
      <span v-if="selectedMemberUser" class="selected-text">
        {{ selectedMemberUser.realName || selectedMemberUser.userName }}
      </span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <i class="el-icon-arrow-down" :class="{ 'is-reverse': isOpen }"></i>
    </div>

    <!-- 下拉菜单 -->
    <transition name="el-zoom-in-top">
      <div v-show="isOpen" class="member-user-select-dropdown">
        <!-- 搜索区域 -->
        <div class="search-area">
          <el-input
            v-model="searchKeyword"
            placeholder="请输入用户名或真实姓名"
            clearable
            @keyup.enter="handleSearch"
            @clear="handleClear"
            ref="searchInputRef"
          >
            <template #append>
              <el-button 
                type="primary" 
                icon="Search" 
                @click="handleSearch"
                :loading="loading"
              >
                查询
              </el-button>
            </template>
          </el-input>
        </div>

        <!-- 会员用户列表 -->
        <div class="member-user-list" v-loading="loading">
          <div 
            v-for="user in memberUserList" 
            :key="user.id"
            class="member-user-item"
            :class="{ 'is-selected': selectedMemberUserId === user.id }"
            @click="selectMemberUser(user)"
          >
            <div class="member-user-info">
              <div class="member-user-name">{{ user.realName || user.userName }}</div>
              <div class="member-user-username">{{ user.userName }}</div>
              <div class="member-user-phone" v-if="user.phoneNumber">{{ user.phoneNumber }}</div>
            </div>
            <div class="member-user-level" v-if="user.memberLevel">
              <el-tag size="small" type="success">{{ user.memberLevel.levelName }}</el-tag>
            </div>
            <i v-if="selectedMemberUserId === user.id" class="el-icon-check"></i>
          </div>
          
          <!-- 空状态 -->
          <div v-if="!loading && memberUserList.length === 0" class="empty-state">
            <i class="el-icon-user"></i>
            <p>暂无会员用户数据</p>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.member-user-select-container {
  position: relative;
  width: 100%;
}

.member-user-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 12px;
  cursor: pointer;
  background-color: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  transition: border-color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1);
}

.member-user-select-trigger:hover {
  border-color: #c0c4cc;
}

.member-user-select-trigger.is-focused {
  border-color: #409eff;
}

.selected-text {
  flex: 1;
  color: #606266;
  text-align: left;
}

.placeholder {
  flex: 1;
  color: #c0c4cc;
  text-align: left;
}

.el-icon-arrow-down {
  color: #c0c4cc;
  transition: transform 0.3s;
}

.el-icon-arrow-down.is-reverse {
  transform: rotate(180deg);
}

.member-user-select-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  z-index: 2000;
  margin-top: 4px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  box-shadow: 0 2px 12px 0 rgb(0 0 0 / 10%);
}

.search-area {
  padding: 12px;
  border-bottom: 1px solid #e4e7ed;
}

.member-user-list {
  max-height: 250px;
  overflow-y: auto;
}

.member-user-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.member-user-item:hover {
  background-color: #f5f7fa;
}

.member-user-item.is-selected {
  color: #409eff;
  background-color: #ecf5ff;
}

.member-user-info {
  flex: 1;
}

.member-user-name {
  margin-bottom: 2px;
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.member-user-username {
  margin-bottom: 2px;
  font-size: 12px;
  color: #909399;
}

.member-user-phone {
  font-size: 12px;
  color: #909399;
}

.member-user-level {
  margin-right: 8px;
}

.member-user-item.is-selected .member-user-name {
  color: #409eff;
}

.el-icon-check {
  color: #409eff;
}

.empty-state {
  padding: 20px;
  color: #909399;
  text-align: center;
}

.empty-state i {
  margin-bottom: 8px;
  font-size: 24px;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}
</style>
