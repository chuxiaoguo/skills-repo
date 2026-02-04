/**
 * 同步控制器
 * 协调同步流程
 */
import { SkillsMPAdapter } from './adapters.js';
import { FeatureExtractor } from './extractors.js';
import { OutputWriter } from './writers.js';
import { fetchGithubContent } from './utils.js';

export class SyncController {
  constructor(config, options = {}) {
    this.config = config;
    this.api = new SkillsMPAdapter(config.skillsmp);
    this.extractor = new FeatureExtractor();
    this.writer = new OutputWriter(config, {
      nonInteractive: options.nonInteractive,
      defaultConflictStrategy: options.defaultConflictStrategy,
    });
    this.options = options;
    this.stats = {
      synced: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      conflicts: 0,
    };
    // 保存所有处理的 skill 数据，用于冲突解决后重保存
    this.processedSkills = [];
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

        // 1. 从 API 获取 skill 信息（获取多个结果，支持选择）
        const searchMethod = options.useAiSearch ? 'aiSearch' : 'search';
        let apiDataList;

        if (searchMethod === 'aiSearch') {
          const result = await this.api.aiSearch(name);
          apiDataList = result.data?.skills || result.data || [];
        } else {
          const result = await this.api.search(name, { limit: 10 });
          apiDataList = result.data?.skills || result.data || [];
        }

        // 过滤出完全匹配 name 的 skills
        const matchedSkills = apiDataList.filter(s => s.name === name);

        if (matchedSkills.length === 0) {
          console.log(`  ⚠️ 未找到: ${name}`);
          this.stats.skipped++;
          continue;
        }

        // 2. 如果找到多个同名 skill，让用户选择
        let apiData;
        if (matchedSkills.length === 1) {
          apiData = matchedSkills[0];
        } else {
          console.log(`  ℹ️  找到 ${matchedSkills.length} 个同名的 "${name}"`);
          apiData = await this.promptUserToSelectSkill(matchedSkills);
          if (!apiData) {
            console.log(`  ⏭️  跳过: ${name}`);
            this.stats.skipped++;
            continue;
          }
        }

        // 3. 提取特征
        const features = this.extractor.extractFromApiData(apiData);

        // 4. 获取 GitHub 仓库内容
        let partialSyncWarning = null;
        if (features.sourceUrl) {
          const githubContent = await fetchGithubContent(features);
          if (githubContent) {
            apiData.content = githubContent.skillMd;
            apiData.files = githubContent.files;
            // 从 GitHub 内容提取更详细的特征，传入 owner 以保持标签一致性
            const extractedFeatures = this.extractor.extract(githubContent.skillMd, {
              owner: features.owner,
              maxTags: 5,
            });
            features.description = features.description || extractedFeatures.description;
            features.tags = features.tags.length > 0 ? features.tags : extractedFeatures.tags;

            // 检测是否只获取了 SKILL.md 而没有获取其他文件（如 reference 目录）
            const hasReferences = githubContent.skillMd.includes('](') &&
              (githubContent.skillMd.includes('reference/') || githubContent.skillMd.includes('.md)'));
            const hasFiles = githubContent.files && githubContent.files.size > 0;

            if (hasReferences && !hasFiles) {
              partialSyncWarning = '⚠️ 部分同步：SKILL.md 已下载，但关联文件（如 reference）可能缺失';
            }
          }
        }

        // 5. 保存 skill（带增量更新检查）
        const saveResult = await this.writer.saveSkill(apiData, features, {
          forceUpdate: options.forceUpdate,
        });

        if (saveResult.saved) {
          results.push(saveResult.data);
          this.stats.synced++;
          if (saveResult.action === 'created') {
            this.stats.created++;
          } else if (saveResult.action === 'updated') {
            this.stats.updated++;
          }
          // 显示部分同步警告
          if (partialSyncWarning) {
            console.log(`  ${partialSyncWarning}`);
            console.log(`     建议：设置 GITHUB_TOKEN 以避免速率限制，或稍后重试`);
          }
        } else if (saveResult.action === 'conflict') {
          // 冲突检测，保存到列表稍后处理
          this.stats.conflicts++;
          this.processedSkills.push(apiData);
          // 暂时不加入 results，等冲突解决后再添加
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
   * 提示用户选择要同步的 skill（当 API 返回多个同名时）
   */
  async promptUserToSelectSkill(skills) {
    const { parseOwnerRepo } = await import('./extractors.js');

    // 按 star 数降序排序
    const sortedSkills = [...skills].sort((a, b) => (b.stars || 0) - (a.stars || 0));

    console.log('\n  发现多个同名 skill，请选择要同步的一个:');
    console.log('  ' + '─'.repeat(65));

    sortedSkills.forEach((skill, index) => {
      const { owner } = parseOwnerRepo(skill.githubUrl);
      const stars = skill.stars || 0;
      const starsStr = stars > 0 ? `⭐ ${stars.toLocaleString()}` : '⭐ 0';
      console.log(`  [${index + 1}] ${skill.name}`);
      console.log(`      作者: ${skill.author || 'N/A'}`);
      console.log(`      来源: ${owner || 'N/A'}`);
      console.log(`      Stars: ${starsStr}`);
      console.log(`      地址: ${skill.githubUrl || 'N/A'}`);
      console.log('');
    });

    console.log('  [0] 跳过此 skill');
    console.log('  ' + '─'.repeat(65));

    if (this.options.nonInteractive) {
      console.log('  [非交互模式] 自动选择 Stars 最高的第一个');
      return sortedSkills[0];
    }

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question('  请输入序号 (0-' + sortedSkills.length + '): ', (input) => {
        rl.close();
        resolve(input.trim());
      });
    });

    const choice = parseInt(answer, 10);
    if (isNaN(choice) || choice < 0 || choice > sortedSkills.length) {
      console.log('  无效输入，自动跳过');
      return null;
    }

    if (choice === 0) {
      return null;
    }

    return sortedSkills[choice - 1];
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
        let partialSyncWarning = null;
        if (features.sourceUrl) {
          const githubContent = await fetchGithubContent(features);
          if (githubContent) {
            skill.content = githubContent.skillMd;
            skill.files = githubContent.files;
            const extractedFeatures = this.extractor.extract(githubContent.skillMd, {
              owner: features.owner,
              maxTags: 5,
            });
            features.description = features.description || extractedFeatures.description;
            features.tags = features.tags.length > 0 ? features.tags : extractedFeatures.tags;

            // 检测是否只获取了 SKILL.md 而没有获取其他文件
            const hasReferences = githubContent.skillMd.includes('](') &&
              (githubContent.skillMd.includes('reference/') || githubContent.skillMd.includes('.md)'));
            const hasFiles = githubContent.files && githubContent.files.size > 0;

            if (hasReferences && !hasFiles) {
              partialSyncWarning = '⚠️ 部分同步：SKILL.md 已下载，但关联文件可能缺失';
            }
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
          // 显示部分同步警告
          if (partialSyncWarning) {
            console.log(`  ${partialSyncWarning}`);
          }
        } else if (saveResult.action === 'conflict') {
          // 冲突检测，保存到列表稍后处理
          this.stats.conflicts++;
          this.processedSkills.push(skill);
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
   * 解决所有待处理的冲突
   */
  async resolveAllConflicts() {
    if (this.stats.conflicts === 0) {
      return [];
    }

    console.log(`\n🔧 开始解决 ${this.stats.conflicts} 个冲突...`);
    const results = await this.writer.resolveAllConflicts(this.processedSkills);

    // 更新统计
    for (const { result } of results) {
      if (result.action === 'replace' || result.action === 'rename') {
        this.stats.synced++;
        this.stats.updated++;
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
