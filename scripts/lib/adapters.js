/**
 * API 适配器层
 * 封装不同数据源的 API 调用
 */

export class SkillsMPAdapter {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
  }

  async request(endpoint, params = {}) {
    // 确保 endpoint 不以 / 开头，否则会替换 baseUrl 的 path
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = new URL(normalizedEndpoint, this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/');

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json',
        'User-Agent': 'skills-sync/1.0 (Node.js)',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`API Error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * 关键字搜索 skills
   */
  async search(query, options = {}) {
    const { page = 1, limit = 20, sortBy = 'stars' } = options;
    return this.request('/skills/search', {
      q: query,
      page,
      limit,
      sortBy,
    });
  }

  /**
   * AI 语义搜索
   */
  async aiSearch(query) {
    return this.request('/skills/ai-search', { q: query });
  }

  /**
   * 获取单个 skill 详情
   */
  async getSkill(name) {
    const result = await this.search(name, { limit: 1 });
    const skills = result.data?.skills || result.data || [];
    if (skills.length > 0) {
      const skill = skills[0];
      if (skill.name === name || skill.name.includes(name)) {
        return skill;
      }
    }
    return null;
  }

  /**
   * 获取热门 skills 列表
   */
  async getTopSkills(limit = 20, sortBy = 'stars') {
    const allSkills = [];
    const maxPerPage = 100;
    let page = 1;
    const searchQuery = 'skill';

    while (allSkills.length < limit) {
      const pageLimit = Math.min(maxPerPage, limit - allSkills.length);
      const result = await this.search(searchQuery, { page, limit: pageLimit, sortBy });

      const skills = result.data?.skills || result.data || [];
      if (!skills || skills.length === 0) break;

      allSkills.push(...skills);
      page++;

      if (skills.length < pageLimit) break;
    }

    return allSkills.slice(0, limit);
  }
}
