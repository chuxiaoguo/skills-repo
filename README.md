# Skills Repo - AI Agent Skills 同步管理系统

一个支持从 skillsmp.com API 同步、管理和合并 AI Agent Skills 的仓库管理系统。

## 功能特性

- 🔗 **API 同步** - 从 skillsmp.com 自动同步热门 Skills
- 📝 **单技能管理** - 每个技能独立的 JSON 文件，便于阅读和版本控制
- 🔄 **增量更新** - 智能检测变更，避免不必要的同步
- 🏷️ **特征提取** - 自动从 SKILL.md 和 API 数据提取特征
- 🔀 **合并输出** - 将分散的单技能 JSON 合并为统一的 skills.json
- ⚙️ **环境配置** - 支持 .env 文件管理敏感配置（API Token）
- 📦 **模块化架构** - 清晰的代码分层，易于维护和扩展

## 项目结构

```
skills-repo/
├── .env                          # 环境变量（API Token）
├── .env.example                  # 环境变量示例
├── .gitignore                    # Git 忽略配置
├── package.json                  # 项目配置和脚本
├── README.md                     # 本文件
├── skills.json                   # 合并后的技能总索引
├── skills-json/                  # 单技能 JSON 目录
│   ├── cache-components.json
│   └── skill-lookup.json
├── scripts/                      # 脚本目录
│   ├── sync-skills.js            # 主同步脚本
│   ├── merge-skills.js           # 合并脚本
│   └── lib/                      # 功能模块
│       ├── adapters.js           # API 适配器
│       ├── config.js             # 配置管理
│       ├── extractors.js         # 特征提取器
│       ├── sync-controller.js    # 同步控制器
│       ├── utils.js              # 工具函数
│       └── writers.js            # 文件写入器
└── skills-collection/            # 技能内容目录
    └── [skill-name]/
        └── SKILL.md
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 复制示例文件
cp .env.example .env

# 编辑 .env，填写你的 API Token
SKILLSMP_API_TOKEN=sk_live_your_token_here
```

> 从 [skillsmp.com/zh/docs/api](https://skillsmp.com/zh/docs/api) 获取 API Token

### 3. 同步 Skills

```bash
# 批量同步热门 Skills（默认 20 个）
npm run skills:sync

# 同步指定数量的 Skills
npm run skills:sync -- --limit 50

# 按名字同步指定 Skills
npm run skills:sync -- --names "react" "vue" "nextjs"

# 使用 AI 语义搜索
npm run skills:sync -- --names "web scraping" --use-ai-search
```

### 4. 合并 Skills

```bash
# 合并所有单技能 JSON 到 skills.json
npm run skills:merge

# 显示详细信息
npm run skills:merge -- --verbose
```

## 技术架构

### 分层设计

```
┌─────────────────────────────────────────┐
│              CLI 层                      │
│   sync-skills.js / merge-skills.js      │
├─────────────────────────────────────────┤
│            控制层                        │
│      SyncController                     │
│   - 协调同步流程                         │
│   - 增量更新检测                         │
├─────────────────────────────────────────┤
│            业务逻辑层                    │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Adapters │ │Extractors│ │ Writers │ │
│  └──────────┘ └──────────┘ └─────────┘ │
├─────────────────────────────────────────┤
│            配置层                        │
│      Config (环境变量管理)               │
└─────────────────────────────────────────┘
```

### 核心模块

#### 1. Adapters（API 适配器）

封装 skillsmp.com REST API 调用：

```javascript
class SkillsMPAdapter {
  async search(query, options)     // 关键字搜索
  async aiSearch(query)            // AI 语义搜索
  async getTopSkills(limit, sortBy) // 获取热门 Skills
}
```

**API 端点：**
- `GET /api/v1/skills/search` - 关键字搜索
- `GET /api/v1/skills/ai-search` - AI 语义搜索

#### 2. Extractors（特征提取器）

从多种数据源提取 Skill 特征：

```javascript
class FeatureExtractor {
  extract(content)                 // 从 SKILL.md 提取
  extractFromApiData(apiData)      // 从 API 响应提取
  inferTagsFromContent(content)    // 从内容推断标签
}
```

**提取字段：**
- `name` - 技能名称
- `description` - 描述
- `tags` - 标签数组
- `version` - 版本号
- `author` - 作者
- `sourceUrl` - GitHub 源地址
- `stars` - GitHub Stars

#### 3. Writers（文件写入器）

处理文件系统操作：

```javascript
class OutputWriter {
  async saveSkill(skillData, features)     // 保存技能
  async checkNeedsUpdate(name, newData)    // 检查是否需要更新
  async mergeSkillsFromDir()               // 合并所有技能
}
```

**输出文件：**
- `skills-json/{name}.json` - 单技能 JSON
- `skills-collection/{name}/SKILL.md` - Skill 文档
- `skills.json` - 合并后的索引

## 环境变量配置

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `SKILLSMP_API_TOKEN` | ✅ | - | skillsmp.com API Token |
| `SKILLSMP_BASE_URL` | ❌ | `https://skillsmp.com/api/v1` | API 基础 URL |

**示例 .env 文件：**

```bash
# SkillsMP API Token
SKILLSMP_API_TOKEN=sk_live_skillsmp_ViwcBS9cwEhzGtGcnec7faxtGkIsM9gxLowPmRShPHU

# 可选：API 基础 URL
# SKILLSMP_BASE_URL=https://skillsmp.com/api/v1
```

## 增量更新机制

系统会智能检测 Skill 是否需要更新：

### 检查流程

1. **读取现有数据** - 从 `skills-json/{name}.json` 读取
2. **字段对比** - 对比以下字段：
   - `description`
   - `version`
   - `author`
   - `sourceUrl`
   - `tags`（排序后比较）
3. **决策输出：**
   - 新技能 → 创建
   - 字段变化 → 更新
   - 无变化 → 跳过

### 使用示例

```bash
# 第一次同步
npm run skills:sync -- --limit 2
# 输出:
#   ✅ 创建: skill-lookup (新技能)
#   ✅ 创建: cache-components (新技能)

# 第二次同步（相同 Skills）
npm run skills:sync -- --limit 2
# 输出:
#   ⏭️  跳过: skill-lookup (无变化)
#   ⏭️  跳过: cache-components (无变化)
```

## 命令行参数

### sync-skills.js

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--names` | string[] | - | 指定要同步的 Skill 名称 |
| `--mode` | string | `batch` | 同步模式：`batch` / `names` |
| `--limit` | number | 20 | 批量同步数量 |
| `--sort` | string | `stars` | 排序方式：`stars` / `recent` |
| `--use-ai-search` | boolean | false | 使用 AI 语义搜索 |
| `--force` | boolean | false | 强制更新（忽略缓存）|

### merge-skills.js

| 参数 | 类型 | 说明 |
|------|------|------|
| `--verbose` / `-v` | boolean | 显示详细信息 |
| `--dry-run` / `-d` | boolean | 试运行（不写入文件）|

## Skills JSON 格式

### 单技能 JSON（skills-json/{name}.json）

```json
{
  "name": "skill-lookup",
  "path": "skill-lookup",
  "description": "Activates when the user asks about Agent Skills...",
  "tags": ["skills", "lookup", "claude"],
  "version": "1.0.0",
  "author": "f",
  "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts/...",
  "stars": 143926,
  "updatedAt": "2026-01-29T12:11:39.382Z"
}
```

### 合并后的 skills.json

```json
{
  "meta": {
    "generatedAt": "2026-01-29T12:15:54.836Z",
    "total": 2
  },
  "skills": [
    {
      "name": "cache-components",
      "path": "cache-components",
      "description": "...",
      "tags": [],
      "version": "1.0.0",
      "author": "vercel"
    }
  ]
}
```

## 开发计划

- [ ] 支持从 GitHub 直接克隆 Skill 仓库
- [ ] 支持 skills.sh CLI 作为数据源
- [ ] 添加 Skill 版本对比功能
- [ ] 支持自定义 Skill 模板
- [ ] 添加 Webhook 自动同步

## 许可证

MIT
