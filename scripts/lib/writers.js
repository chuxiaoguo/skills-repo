/**
 * 输出写入层
 * 处理 skill 文件的写入和更新
 */
import fs from 'fs/promises';
import path from 'path';

export class OutputWriter {
  constructor(config) {
    this.config = config;
    this.skillsDir = config.paths.skillsDir;
    this.skillsJsonPath = config.paths.skillsJson;
  }

  /**
   * 确保目录存在
   */
  async ensureDir(dir) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * 读取现有的 skills.json
   */
  async readSkillsJson() {
    try {
      const content = await fs.readFile(this.skillsJsonPath, 'utf-8');
      const data = JSON.parse(content);
      return {
        skills: Array.isArray(data.skills) ? data.skills : [],
        meta: data.meta || {},
      };
    } catch {
      return { skills: [], meta: {} };
    }
  }

  /**
   * 读取单个 skill 的 JSON 文件
   */
  async readSkillJson(skillName) {
    const skillJsonPath = path.join(this.skillsDir, `${skillName}.json`);
    try {
      const content = await fs.readFile(skillJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 检查 skill 是否需要更新
   * @returns {Object} { needsUpdate: boolean, reason: string }
   */
  async checkNeedsUpdate(skillName, newData) {
    const existingSkillJson = await this.readSkillJson(skillName);

    if (!existingSkillJson) {
      return { needsUpdate: true, reason: '新技能' };
    }

    // 检查关键字段是否有变化
    const fieldsToCheck = ['description', 'version', 'author', 'sourceUrl'];
    for (const field of fieldsToCheck) {
      const oldValue = existingSkillJson[field];
      const newValue = newData[field];
      if (oldValue !== newValue) {
        return { needsUpdate: true, reason: `${field} 变化: ${oldValue} -> ${newValue}` };
      }
    }

    // 检查 tags
    const oldTags = (existingSkillJson.tags || []).sort().join(',');
    const newTags = (newData.tags || []).sort().join(',');
    if (oldTags !== newTags) {
      return { needsUpdate: true, reason: 'tags 变化' };
    }

    return { needsUpdate: false, reason: '无变化' };
  }

  /**
   * 保存 skill 到目录
   * @returns {Object} { saved: boolean, path: string, action: 'created'|'updated'|'skipped' }
   */
  async saveSkill(skillData, features) {
    const skillName = skillData.name;

    // 检查是否需要更新
    const { needsUpdate, reason } = await this.checkNeedsUpdate(skillName, features);

    if (!needsUpdate) {
      console.log(`  ⏭️  跳过: ${skillName} (${reason})`);
      return { saved: false, action: 'skipped', reason };
    }

    // 确保目录存在
    await this.ensureDir(this.skillsDir);

    // 写入 SKILL.md（保持原始内容，不添加 frontmatter）
    const skillDir = path.join(this.config.paths.skillsCollection, skillName);
    await this.ensureDir(skillDir);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    // 使用原始内容，不重新构建 frontmatter
    const skillMdContent = skillData.content || '';
    await fs.writeFile(skillMdPath, skillMdContent, 'utf-8');

    // 写入其他文件（如 scripts 目录下的文件）
    if (skillData.files && skillData.files instanceof Map) {
      for (const [filePath, content] of skillData.files) {
        const fullPath = path.join(skillDir, filePath);
        // 确保子目录存在
        await this.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf-8');
      }
    }

    // 写入单独的 JSON 文件
    const skillJsonPath = path.join(this.skillsDir, `${skillName}.json`);
    const skillJsonData = {
      name: features.name,
      path: skillName,
      description: features.description,
      tags: features.tags,
      version: features.version,
      author: features.author,
      sourceUrl: features.sourceUrl,
      stars: features.stars,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(skillJsonPath, JSON.stringify(skillJsonData, null, 2), 'utf-8');

    const action = reason === '新技能' ? 'created' : 'updated';
    console.log(`  ✅ ${action === 'created' ? '创建' : '更新'}: ${skillName} (${reason})`);

    return {
      saved: true,
      action,
      path: skillDir,
      data: skillJsonData,
    };
  }

  /**
   * 更新 skills.json（合并所有单技能 JSON）
   */
  async updateSkillsJson(skills) {
    const existing = await this.readSkillsJson();

    // 合并 skills（同名覆盖）
    const skillMap = new Map(existing.skills.map(s => [s.name, s]));

    for (const skill of skills) {
      skillMap.set(skill.name, {
        ...skillMap.get(skill.name),
        ...skill,
        updatedAt: new Date().toISOString(),
      });
    }

    const data = {
      meta: {
        ...existing.meta,
        generatedAt: new Date().toISOString(),
        total: skillMap.size,
      },
      skills: Array.from(skillMap.values()),
    };

    await fs.writeFile(this.skillsJsonPath, JSON.stringify(data, null, 2), 'utf-8');

    return data;
  }

  /**
   * 从 skills 目录合并所有单技能 JSON 到 skills.json
   */
  async mergeSkillsFromDir() {
    await this.ensureDir(this.skillsDir);

    const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(path.join(this.skillsDir, entry.name), 'utf-8');
        const skill = JSON.parse(content);
        skills.push(skill);
      } catch (error) {
        console.warn(`  ⚠️ 解析失败: ${entry.name} - ${error.message}`);
      }
    }

    // 按名称排序
    skills.sort((a, b) => a.name.localeCompare(b.name));

    const data = {
      meta: {
        generatedAt: new Date().toISOString(),
        total: skills.length,
      },
      skills,
    };

    await fs.writeFile(this.skillsJsonPath, JSON.stringify(data, null, 2), 'utf-8');

    return data;
  }
}
