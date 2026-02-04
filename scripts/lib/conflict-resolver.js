/**
 * 冲突解析器
 * 处理 skill 同步时的同名冲突
 */
import readline from 'readline';

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

/**
 * 冲突上下文
 */
export class ConflictContext {
  constructor(existing, incoming) {
    this.existing = existing;    // 本地现有 skill
    this.incoming = incoming;    // 待同步 skill
    this.resolution = null;      // 'skip' | 'replace' | 'keep-both'
  }

  /**
   * 获取重命名后的名称
   */
  getRenamedName() {
    const owner = this.incoming.owner || parseOwnerRepo(this.incoming.sourceUrl).owner;
    return `${owner}-${this.incoming.name}`;
  }

  /**
   * 格式化日期显示
   */
  formatDate(dateString) {
    if (!dateString) return '未知';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('zh-CN');
  }
}

/**
 * 冲突解析器
 */
export class ConflictResolver {
  constructor(options = {}) {
    this.queue = [];           // 冲突队列
    this.resolved = [];        // 已解决的冲突
    this.nonInteractive = options.nonInteractive || false;
    this.defaultStrategy = options.defaultStrategy || 'skip'; // skip | replace | keep-both
  }

  /**
   * 添加冲突到队列
   */
  addConflict(existing, incoming) {
    this.queue.push(new ConflictContext(existing, incoming));
  }

  /**
   * 检测是否会产生冲突
   * @param {Object} existing - 本地现有 skill（可能为 null）
   * @param {Object} incoming - 待同步 skill
   * @returns {boolean} true 表示是同名不同源的冲突
   */
  isConflict(existing, incoming) {
    if (!existing) return false;

    // 同名但不同来源 = 冲突
    const existingOwner = existing.owner || parseOwnerRepo(existing.sourceUrl).owner;
    const incomingOwner = incoming.owner || parseOwnerRepo(incoming.sourceUrl).owner;

    if (existing.name === incoming.name && existingOwner !== incomingOwner) {
      return true;
    }

    return false;
  }

  /**
   * 显示冲突信息
   */
  displayConflict(context, index, total) {
    console.log('\n' + '─'.repeat(65));
    if (total > 1) {
      console.log(`⚠️  发现同名 Skill 冲突 [${index}/${total}]`);
    } else {
      console.log('⚠️  发现同名 Skill 冲突');
    }
    console.log('─'.repeat(65));

    const existingOwner = context.existing.owner || parseOwnerRepo(context.existing.sourceUrl).owner;
    const incomingOwner = context.incoming.owner || parseOwnerRepo(context.incoming.sourceUrl).owner;

    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 本地现有                                                      │');
    console.log(`│   名称: ${context.existing.name.padEnd(53)}│`);
    console.log(`│   来源: ${`${existingOwner}/${context.existing.name}`.padEnd(53)}│`);
    console.log(`│   版本: ${(context.existing.version || '未知').padEnd(53)}│`);
    console.log(`│   作者: ${(context.existing.author || '未知').padEnd(53)}│`);
    console.log(`│   更新: ${context.formatDate(context.existing.updatedAt).padEnd(53)}│`);
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log('│ 待同步（新）                                                  │');
    console.log(`│   名称: ${context.incoming.name.padEnd(53)}│`);
    console.log(`│   来源: ${`${incomingOwner}/${context.incoming.name}`.padEnd(53)}│`);
    console.log(`│   版本: ${(context.incoming.version || '未知').padEnd(53)}│`);
    console.log(`│   作者: ${(context.incoming.author || '未知').padEnd(53)}│`);
    console.log(`│   更新: ${context.formatDate(context.incoming.updatedAt).padEnd(53)}│`);
    console.log('└─────────────────────────────────────────────────────────────┘');

    console.log('\n请选择操作:');
    console.log('  [s] 跳过 - 保留本地现有 skill');
    console.log('  [r] 替换 - 用新 skill 覆盖本地');
    console.log('  [k] 保留两者 - 新 skill 添加前缀命名');
  }

  /**
   * 交互式询问用户
   */
  async promptUser() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('\n输入选择 (s/r/k): ', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase());
      });
    });
  }

  /**
   * 处理单个冲突
   * @param {ConflictContext} context
   * @param {Array} allLocalSkills - 所有本地 skills（用于检查二次冲突）
   * @param {number} index - 当前冲突索引
   * @param {number} total - 冲突总数
   * @returns {Object} { action: 'skip' | 'replace' | 'rename', target?, newName?, warning? }
   */
  async handleConflict(context, allLocalSkills, index = 1, total = 1) {
    this.displayConflict(context, index, total);

    let choice;
    if (this.nonInteractive) {
      choice = this.defaultStrategy.charAt(0);
      console.log(`\n[非交互模式] 使用默认策略: ${this.defaultStrategy}`);
    } else {
      choice = await this.promptUser();
    }

    switch (choice) {
      case 's': // 跳过
        context.resolution = 'skip';
        return { action: 'skip' };

      case 'r': // 替换
        context.resolution = 'replace';
        return { action: 'replace', target: context.existing.name };

      case 'k': // 保留两者
        context.resolution = 'keep-both';
        const newName = context.getRenamedName();

        // 检查二次冲突
        const exists = allLocalSkills.find(s => s.name === newName);
        if (exists) {
          const existingOwner = exists.owner || parseOwnerRepo(exists.sourceUrl).owner;
          const incomingOwner = context.incoming.owner || parseOwnerRepo(context.incoming.sourceUrl).owner;

          const warning = `⚠️  告警: 存在替换同名技能 ${newName} 的操作\n   ${existingOwner}/${exists.repo || exists.name} 将被 ${incomingOwner}/${context.incoming.repo || context.incoming.name} 替换`;
          console.warn('\n' + warning);

          return {
            action: 'replace',
            target: newName,
            warning,
            originalName: context.incoming.name,
          };
        }

        return {
          action: 'rename',
          newName,
          originalName: context.incoming.name,
        };

      default:
        // 无效输入，默认跳过
        console.log('无效输入，默认选择跳过');
        context.resolution = 'skip';
        return { action: 'skip' };
    }
  }

  /**
   * 解决所有冲突
   * @param {Array} allLocalSkills - 所有本地 skills
   * @returns {Array} 已解决的冲突结果
   */
  async resolveAll(allLocalSkills) {
    for (let i = 0; i < this.queue.length; i++) {
      const context = this.queue[i];
      const result = await this.handleConflict(context, allLocalSkills, i + 1, this.queue.length);

      // 应用解决结果
      this.applyResolution(context, result, allLocalSkills);
      this.resolved.push({ conflict: context, result });
    }

    // 打印摘要
    if (this.resolved.length > 0) {
      this.printSummary();
    }

    return this.resolved;
  }

  /**
   * 应用解决结果
   */
  applyResolution(context, result, allLocalSkills) {
    switch (result.action) {
      case 'skip':
        // 不做任何操作
        break;
      case 'replace':
        // 更新本地 skill 列表中的引用
        const index = allLocalSkills.findIndex(s => s.name === result.target);
        if (index !== -1) {
          allLocalSkills[index] = { ...context.incoming, name: result.target };
        }
        break;
      case 'rename':
        // 添加重命名后的 skill
        allLocalSkills.push({
          ...context.incoming,
          name: result.newName,
          originalName: result.originalName,
        });
        break;
    }
  }

  /**
   * 打印处理摘要
   */
  printSummary() {
    console.log('\n' + '═'.repeat(65));
    console.log('                 冲突处理摘要');
    console.log('═'.repeat(65));

    const skipped = this.resolved.filter(r => r.result.action === 'skip');
    const replaced = this.resolved.filter(r => r.result.action === 'replace');
    const renamed = this.resolved.filter(r => r.result.action === 'rename');

    console.log(`  跳过:       ${skipped.length} 个`);
    console.log(`  替换:       ${replaced.length} 个`);
    console.log(`  重命名保留: ${renamed.length} 个`);
    console.log('═'.repeat(65));

    // 列出重命名的 skills
    if (renamed.length > 0) {
      console.log('\n  重命名的 skills:');
      for (const item of renamed) {
        console.log(`    • ${item.conflict.incoming.name} → ${item.result.newName}`);
      }
    }

    // 列出有警告的替换
    const warnings = this.resolved.filter(r => r.result.warning);
    if (warnings.length > 0) {
      console.log('\n  告警记录:');
      for (const item of warnings) {
        console.log(`    • ${item.result.warning.replace(/\n/g, '\n      ')}`);
      }
    }
  }

  /**
   * 获取冲突统计
   */
  getStats() {
    return {
      total: this.resolved.length,
      skipped: this.resolved.filter(r => r.result.action === 'skip').length,
      replaced: this.resolved.filter(r => r.result.action === 'replace').length,
      renamed: this.resolved.filter(r => r.result.action === 'rename').length,
    };
  }
}
