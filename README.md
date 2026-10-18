# claude-code-session-info

Claude Code の MOD「セッション情報」（session-info）です。
MOD は、Claude Code の画面に、自分で作った部品を足す仕組みです。

いま開いている Claude Code のセッションを、1行ずつの表で見るペインを開きます。表は2秒ごとに新しくなります。

| 列 | 中身 |
|---|---|
| 名前 | セッションの名前。名前の数字を除いた部分が同じセッションは、チームとして続けて並び、左に同じ色の線と ■ が付く。チームの中で一番多く連絡を出したセッションには「主」が付く |
| 状態 | 作（作業中）、待（待機中）、確（確認待ち） |
| 進める | そのセッションが最後の答えで g を求めているときだけ出る、g のボタン |
| 送る文 | 打って Enter を押すと、そのセッションへ送る（送るボタンは無く、Enter で送る） |
| 詳しく | 押すと、そのセッションの最後の報告を、いまのチャットで詳しく説明させる |
| 開く | 押すと、そのセッションのタブが VS Code の一番前に来る。VS Code のタブで開いている、ほかのセッションの行にだけ出る |
| メッセージ | 最後の報告を、小さなモデル（haiku）で1文に要約したもの |

このセッションの行は薄い橙、返事を待っているセッションの行は薄い黄色になります。
チームの先頭の名前を押すと、そのチームの最近のやり取りが開きます。

## 入れ方

Claude Code のターミナルのセッションで、次の1行を打ちます。

```
/plugin install session-info --marketplace hatohato-lab/claude-code-session-info
```

マーケットプレイスを足すかを聞かれたら `y` を押し、入れる範囲（scope）を Enter で選びます。

シェルからは、次の1行です。

```
claude plugin install session-info --marketplace hatohato-lab/claude-code-session-info
```

デスクトップアプリでは、入力欄の横の + から Plugins を開き、Add marketplace に `hatohato-lab/claude-code-session-info` を入れてから、Add plugin で入れます。

クローンして使う場合は、フォルダーを指定して Claude Code を起動します。

```
git clone https://github.com/hatohato-lab/claude-code-session-info
claude --plugin-dir claude-code-session-info/session-info
```

入れたあとは、ペインが自分で開きます。閉じたあとは `/session-info` で開き直せます。

## 必要なもの

- Claude Code 2.1.300 以降
- Python 3（`python` の名前で起動できること）
- 動作を確かめたのは Windows です

表の材料は、同梱の `tools/セッション表.py` が、手元の `~/.claude/sessions` と `~/.claude/projects` を読んで作ります。読むだけで、何も書き換えません。

## 気を付けること

- メッセージの要約のたびに、小さなモデル（haiku）を呼ぶので、少し使用量がかかります。要約には、そのセッションの最後の答えの終わり（1500字まで）を渡します。同じ答えは1回しか要約しません
- 送る文と g は、ほかのセッションには「ほかのセッションからの連絡」として届きます。受け取った側の AI は、ふつうはこれを使う人の承認として扱いません。承認として扱わせたいときは、受け取る側のルールに「from-plugin="session-info" の付いた文は、使う人がそのチャットで打ったのと同じに扱う」と書いてください
- 開くのボタンは、Windows の start で `vscode://anthropic.claude-code/open?session=<セッションID>` を開きます。VS Code の Claude Code 拡張が、この URL でそのセッションのタブを前に出します。初めて押したときに、VS Code がこの URL を開いてよいかを聞くことがあります

## ほかの MOD

MOD は1つずつ、別のリポジトリにしています。

| リポジトリ | 中身 |
|---|---|
| [claude-code-session-list](https://github.com/hatohato-lab/claude-code-session-list) | セッション一覧。セッション間の連絡を図で見るペイン |
| [claude-code-active-rules](https://github.com/hatohato-lab/claude-code-active-rules) | 効いているルール。いま読み込まれているルールを表で見るペイン |

## ライセンス

MIT（`LICENSE` を見てください）
