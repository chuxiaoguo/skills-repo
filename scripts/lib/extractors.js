/**
 * 特征提取层
 * 从各种数据源提取 skill 特征
 */
import matter from 'gray-matter';

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
  extractFromApiData(apiData) {
    return {
      name: apiData.name || '',
      description: apiData.description || apiData.summary || '',
      tags: this.normalizeTags(apiData.tags || apiData.categories),
      version: apiData.version || '1.0.0',
      author: apiData.author || apiData.owner || '',
      sourceUrl: apiData.githubUrl || apiData.repository || apiData.url || '',
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
      'react': ['frontend', 'react'],
      'vue': ['frontend', 'vue'],
      'angular': ['frontend', 'angular'],
      'frontend': ['frontend'],
      'backend': ['backend'],
      'node': ['backend', 'nodejs'],
      'express': ['backend', 'express'],
      'database': ['database'],
      'sql': ['database', 'sql'],
      'test': ['testing'],
      'testing': ['testing'],
      'jest': ['testing', 'jest'],
      'git': ['git', 'version-control'],
      'github': ['git', 'github'],
      'design': ['design'],
      'ui': ['design', 'ui'],
      'ux': ['design', 'ux'],
      'api': ['api'],
      'rest': ['api', 'rest'],
      'graphql': ['api', 'graphql'],
      'security': ['security'],
      'auth': ['security', 'authentication'],
      'debug': ['debugging'],
      'performance': ['performance'],
      'optimize': ['performance'],
    };

    for (const [keyword, associatedTags] of Object.entries(keywordMap)) {
      if (contentLower.includes(keyword)) {
        associatedTags.forEach(tag => tags.add(tag));
      }
    }

    return Array.from(tags);
  }
}
