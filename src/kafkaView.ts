import * as vscode from "vscode";
import { BasicDeployApi, KafkaTopic } from "./api";
import { formatBytes } from "./util";

export class TopicNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly topic?: KafkaTopic,
    icon?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (topic) {
      this.contextValue = "bdTopic";
      this.iconPath = new vscode.ThemeIcon("symbol-event");
      this.description = `${topic.partitions}p · ${formatBytes(topic.reservedBytes)}`;
      this.tooltip = `${topic.name}\npartitions: ${topic.partitions}\nretention: ${Math.round(topic.retentionMs / 3600000)}h`;
    } else if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

// Lists the user's Kafka topics with usage, plus create/purge/delete actions.
// Kafka is enabled for every account, but the view degrades gracefully if the
// broker reports it disabled.
export class KafkaProvider implements vscode.TreeDataProvider<TopicNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<TopicNode[]> {
    let info;
    try {
      info = await this.api.kafkaInfo();
    } catch {
      return [];
    }
    if (!info.enabled) {
      return [new TopicNode("Kafka is not enabled", undefined, "circle-slash")];
    }
    if (info.topics.length === 0) {
      const empty = new TopicNode(
        `No topics yet (limit ${info.limits.maxTopics})`,
        undefined,
        "info",
      );
      return [empty];
    }
    return info.topics
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => new TopicNode(t.name, t));
  }
}
