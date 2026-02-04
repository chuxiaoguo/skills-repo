/**
 * 特征提取层
 * 从各种数据源提取 skill 特征
 */
import matter from 'gray-matter';

/**
 * 从 sourceUrl 解析 owner 和 repo
 * @param {string} sourceUrl - 如 https://github.com/owner/repo
 * @returns {Object} { owner, repo }
 */
export function parseOwnerRepo(sourceUrl) {
  if (!sourceUrl) return { owner: '', repo: '' };

  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return {
        owner: parts[0],
        repo: parts[1].replace(/\.git$/, ''),
      };
    }
  } catch {
    // 尝试正则匹配
    const match = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return { owner: '', repo: '' };
}

export class FeatureExtractor {
  /**
   * 从 SKILL.md 内容提取特征
   */
  extract(content) {
    const parsed = matter(content);
    const frontmatter = parsed.data || {};

    const features = {
      name: frontmatter.name || '',
      description: frontmatter.description || '',
      tags: this.normalizeTags(frontmatter.tags),
      version: frontmatter.version || '1.0.0',
      author: frontmatter.author || '',
    };

    // 如果缺少描述，从内容中提取第一段
    if (!features.description && parsed.content) {
      features.description = this.extractDescriptionFromContent(parsed.content);
    }

    // 如果缺少 tags，从内容中推断
    if (features.tags.length === 0 && parsed.content) {
      features.tags = this.inferTagsFromContent(parsed.content);
    }

    return features;
  }

  /**
   * 从 API 返回的数据中提取特征
   */
  extractFromApiData(apiData, options = {}) {
    // 尝试从多个可能的字段中提取 tags
    const rawTags = apiData.tags
      || apiData.categories
      || apiData.topics
      || apiData.keywords
      || apiData.labels;

    if (options.debug) {
      console.log(`  [extractFromApiData] ${apiData.name}:`, {
        hasTags: !!apiData.tags,
        hasCategories: !!apiData.categories,
        hasTopics: !!apiData.topics,
        hasKeywords: !!apiData.keywords,
        hasLabels: !!apiData.labels,
        extractedTags: this.normalizeTags(rawTags),
      });
    }

    const sourceUrl = apiData.githubUrl || apiData.repository || apiData.url || '';
    const { owner, repo } = parseOwnerRepo(sourceUrl);

    return {
      name: apiData.name || '',
      description: apiData.description || apiData.summary || '',
      tags: this.normalizeTags(rawTags),
      version: apiData.version || '1.0.0',
      author: apiData.author || apiData.owner || '',
      owner,
      repo: repo || apiData.name || '',
      sourceUrl,
      stars: apiData.stars || 0,
      updatedAt: apiData.updatedAt ? new Date(apiData.updatedAt * 1000).toISOString() : null,
    };
  }

  /**
   * 标准化 tags
   */
  normalizeTags(tags) {
    if (!tags) return [];
    if (typeof tags === 'string') return tags.split(/[,;]/).map(t => t.trim()).filter(Boolean);
    if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
    return [];
  }

  /**
   * 从 Markdown 内容提取描述（第一段非空文本）
   */
  extractDescriptionFromContent(content) {
    const lines = content.split('\n');
    let description = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue;
      description = trimmed;
      break;
    }

    return description.length > 200
      ? description.substring(0, 197) + '...'
      : description;
  }

  /**
   * 从内容推断 tags
   */
  inferTagsFromContent(content) {
    const tags = new Set();
    const contentLower = content.toLowerCase();

    const keywordMap = {
      // 前端框架
      'react': ['frontend', 'react'],
      'vue': ['frontend', 'vue'],
      'angular': ['frontend', 'angular'],
      'frontend': ['frontend'],
      'next.js': ['nextjs', 'frontend', 'react'],
      'nextjs': ['nextjs', 'frontend', 'react'],

      // 后端
      'backend': ['backend'],
      'node': ['backend', 'nodejs'],
      'express': ['backend', 'express'],

      // 数据库
      'database': ['database'],
      'sql': ['database', 'sql'],

      // 测试
      'test': ['testing'],
      'testing': ['testing'],
      'jest': ['testing', 'jest'],

      // Git/版本控制
      'git': ['git', 'version-control'],
      'github': ['git', 'github'],

      // 设计
      'design': ['design'],
      'ui': ['design', 'ui'],
      'ux': ['design', 'ux'],

      // API
      'api': ['api'],
      'rest': ['api', 'rest'],
      'graphql': ['api', 'graphql'],

      // 安全
      'security': ['security'],
      'auth': ['security', 'authentication'],

      // 调试与性能
      'debug': ['debugging'],
      'performance': ['performance'],
      'optimize': ['performance'],
      'cache': ['caching', 'performance'],

      // Skill/CLI 相关
      'skill': ['skills', 'cli'],
      'cli': ['cli'],

      // 代码生成
      'write': ['code-generation', 'writing'],
      'author': ['code-generation', 'writing'],
      'create': ['code-generation'],
      'generate': ['code-generation'],
      'scaffold': ['code-generation', 'scaffolding'],

      // 搜索/查询
      'search': ['search', 'discovery'],
      'lookup': ['search', 'discovery'],
      'find': ['search', 'discovery'],
      'install': ['discovery'],

      // 文档
      'documentation': ['documentation', 'dx'],
      'docs': ['documentation', 'dx'],
      'mdx': ['documentation', 'mdx'],

      // 规划/设计
      'brainstorm': ['planning', 'design'],
      'idea': ['planning'],
      'plan': ['planning'],

      // 文件操作
      'file': ['filesystem', 'io'],
      'fs': ['filesystem', 'io'],
      'bun': ['bun', 'runtime'],

      // 组件
      'component': ['components', 'frontend'],

      // 更新/同步
      'update': ['automation', 'maintenance'],
      'sync': ['automation', 'maintenance'],
    };

    for (const [keyword, associatedTags] of Object.entries(keywordMap)) {
      // 使用单词边界匹配，避免子字符串误匹配
      // 例如 "test" 不应该匹配 "testing" 中的子串
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(contentLower)) {
        associatedTags.forEach(tag => tags.add(tag));
      }
    }

    return Array.from(tags);
  }
}
