/**
 * 同步控制器
 * 协调同步流程
 */
import { SkillsMPAdapter } from './adapters.js';
import { FeatureExtractor } from './extractors.js';
import { OutputWriter } from './writers.js';
import { fetchGithubContent } from './utils.js';

export class SyncController {
  constructor(config) {
    this.config = config;
    this.api = new SkillsMPAdapter(config.skillsmp);
    this.extractor = new FeatureExtractor();
    this.writer = new OutputWriter(config);
    this.stats = {
      synced: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }

  /**
   * 按名字同步指定 skills
   */
  async syncByNames(names, options = {}) {
    console.log(`🔄 开始同步 ${names.length} 个指定 skills...\n`);

    const results = [];

    for (const name of names) {
      try {
        console.log(`📦 同步: ${name}`);

        // 1. 从 API 获取 skill 信息
        const searchMethod = options.useAiSearch ? 'aiSearch' : 'search';
        let apiData;

        if (searchMethod === 'aiSearch') {
          const result = await this.api.aiSearch(name);
          const skills = result.data?.skills || result.data || [];
          apiData = skills[0];
        } else {
          const result = await this.api.search(name, { limit: 1 });
          const skills = result.data?.skills || result.data || [];
          apiData = skills[0];
        }

        if (!apiData) {
          console.log(`  ⚠️ 未找到: ${name}`);
          this.stats.skipped++;
          continue;
        }

        // 2. 提取特征
        const features = this.extractor.extractFromApiData(apiData);

        // 3. 获取 GitHub 仓库内容
        if (features.sourceUrl) {
          const githubContent = await fetchGithubContent(features);
          if (githubContent) {
            apiData.content = githubContent;
            // 从 GitHub 内容提取更详细的特征
            const extractedFeatures = this.extractor.extract(githubContent);
            features.description = features.description || extractedFeatures.description;
            features.tags = features.tags.length > 0 ? features.tags : extractedFeatures.tags;
          }
        }

        // 4. 保存 skill（带增量更新检查）
        const saveResult = await this.writer.saveSkill(apiData, features);

        if (saveResult.saved) {
          results.push(saveResult.data);
          this.stats.synced++;
          if (saveResult.action === 'created') {
            this.stats.created++;
          } else if (saveResult.action === 'updated') {
            this.stats.updated++;
          }
        } else {
          // 即使没有保存，也要把现有数据加入结果
          const existingData = await this.writer.readSkillJson(apiData.name);
          if (existingData) {
            results.push(existingData);
          }
          this.stats.skipped++;
        }

      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({ name, error: error.message });
        console.error(`  ❌ 失败: ${name} - ${error.message}`);
      }
    }

    return results;
  }

  /**
   * 批量同步热门 skills
   */
  async syncBatch(limit, sortBy) {
    console.log(`🔄 开始批量同步前 ${limit} 个热门 skills (按 ${sortBy})...\n`);

    const skills = await this.api.getTopSkills(limit, sortBy);
    console.log(`📋 获取到 ${skills.length} 个 skills\n`);

    const results = [];

    for (const skill of skills) {
      try {
        console.log(`📦 同步: ${skill.name}`);

        const features = this.extractor.extractFromApiData(skill);

        // 获取详细内容
        if (features.sourceUrl) {
          const githubContent = await fetchGithubContent(features);
          if (githubContent) {
            skill.content = githubContent;
            const extractedFeatures = this.extractor.extract(githubContent);
            features.description = features.description || extractedFeatures.description;
            features.tags = features.tags.length > 0 ? features.tags : extractedFeatures.tags;
          }
        }

        // 保存
        const saveResult = await this.writer.saveSkill(skill, features);

        if (saveResult.saved) {
          results.push(saveResult.data);
          this.stats.synced++;
          if (saveResult.action === 'created') {
            this.stats.created++;
          } else if (saveResult.action === 'updated') {
            this.stats.updated++;
          }
        } else {
          const existingData = await this.writer.readSkillJson(skill.name);
          if (existingData) {
            results.push(existingData);
          }
          this.stats.skipped++;
        }

      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({ name: skill.name, error: error.message });
        console.error(`  ❌ 失败: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * 打印统计信息
   */
  printStats() {
    console.log('\n📊 同步统计:');
    console.log(`  ✅ 成功: ${this.stats.synced} (新建: ${this.stats.created}, 更新: ${this.stats.updated})`);
    console.log(`  ⏭️  跳过: ${this.stats.skipped}`);
    console.log(`  ❌ 失败: ${this.stats.failed}`);

    if (this.stats.errors.length > 0) {
      console.log('\n❌ 错误详情:');
      this.stats.errors.forEach(({ name, error }) => {
        console.log(`  - ${name}: ${error}`);
      });
    }
  }
}
