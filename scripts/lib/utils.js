/**
 * 工具函数
 * 包括 GitHub 内容获取、命令行解析等
 */

/**
 * 从 GitHub 获取 skill 内容
 */
export async function fetchGithubContent(features) {
  try {
    const repoMatch = features.sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) return null;

    const [, owner, repo] = repoMatch;

    // 尝试获取 SKILL.md 原始内容
    const branches = ['main', 'master'];
    let content = null;

    for (const branch of branches) {
      try {
        const skillMdUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/SKILL.md`;
        const response = await fetch(skillMdUrl, {
          headers: { 'User-Agent': 'skills-sync/1.0' },
        });

        if (response.ok) {
          content = await response.text();
          break;
        }
      } catch {
        // 继续尝试下一个分支
      }
    }

    return content;
  } catch (error) {
    console.log(`  ⚠️ 无法获取 GitHub 内容: ${error.message}`);
    return null;
  }
}

/**
 * 解析命令行参数
 */
export function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: 'batch',
    names: [],
    limit: 20,
    sortBy: 'stars',
    useAiSearch: false,
    forceUpdate: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--names':
        options.mode = 'names';
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          options.names.push(args[++i]);
        }
        break;
      case '--mode':
        options.mode = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10) || 20;
        break;
      case '--sort':
        options.sortBy = args[++i] || 'stars';
        break;
      case '--use-ai-search':
        options.useAiSearch = true;
        break;
      case '--force':
        options.forceUpdate = true;
        break;
    }
  }

  return options;
}
