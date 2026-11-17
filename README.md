# UATドメインパック スターターキット

商品知識とQAグループの業務知識を合わせ持つドメインパックを、Claude Code で育てて使うための雛形です。
中身はすべて例（架空）です。実際の内容は社内の資料から抽出して埋めてください。

## 最初にやること

1. このフォルダを社内のリポジトリに置き、Claude Code をこのフォルダで起動する。
2. 書き換え防止が効いているか確認する：
   「pack/00_目次.md の1行目を変えて」と頼み、**拒否されれば OK**。
   拒否されない場合は `.claude/settings.json` のパスの書き方を `Edit(pack/**)` などに変えて再確認する。
3. ペアワイズが動くか確認する：
   ```
   node tools/pairwise.js models/sample/購入.txt --verify --format md
   ```
   1296通り → 15行前後、「判定: OK」と出れば OK。
4. 生資料（Slack・Confluence の書き出し）は `raw/` に置く（Git 管理外）。

## 構成

```
CLAUDE.md            Claudeへの指示（役割・絶対ルール・作業の種類）
.claude/settings.json  pack/rulebook/schema の書き換えを禁止
.claude/skills/pairwise/  ペアワイズのスキル
pack/                ドメインパック（何が正しいか）
  00_目次.md         第1層：全体地図。Claudeは最初にここだけ読む
  classes/           同値クラス（振る舞いが同じグループと代表）
  impact-map.md      差分マップ・連鎖マップ
  master/供給経路.csv  1行1経路の商品マスタ（詳細は書き写さず参照先を書く）
  flow/ products/ variation/  段階・付帯商品・軸ごとの差分
  qa/                QAグループの経験知（過去不具合・勘所・問い合わせ先）
rulebook/            どう作るか（技法・優先度・スコープ判定・指摘の振り分け）
schema/              どんな形で出すか（testcase / scope）
env/                 環境・事前設定・テストデータ
models/              ペアワイズのモデル（案件ごと）
output/              成果物（案件ごと）
questions/           質問のたね
proposals/           パック等への修正提案（人が承認して反映）
logs/指摘ログ.csv    指摘の記録
tools/pairwise.js    ペアワイズ生成（Node.jsのみ、PICT形式のモデル）
```

## 進め方（おすすめの順番）

1. **地図から**：`pack/impact-map.md` の差分マップを、Claude に資料から下書きさせる。「?」は質問のたねへ。
2. **クラス分け**：`pack/classes` と `pack/master` を、直近の案件で触る経路から埋める。
3. **1案件で試す**：スコープ判定 → ペアワイズ → ケース作成 を通しで1回やる。
4. **調整を3回**：指摘を `logs/` に記録し、`rulebook/指摘の振り分け.md` に沿って反映する。

## 抽出作業を頼むときの例

> raw/confluence/ の資料から、pack の構成案だけを proposals/ に出して。
> 中身の抽出はまだしないで。CLAUDE.md の絶対ルールに従って。

承認後：

> 承認した構成で、「購入」段階の内容だけを抽出して proposals/ に出して。
> 出典・日付・確度を全行に付けて、不明点は質問のたねに追記して。
