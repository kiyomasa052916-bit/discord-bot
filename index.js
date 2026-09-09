require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const sharp = require('sharp');
const http = require('http');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// ==================================================
// 設定
// ==================================================

const START_COINS = 5000;
const DAILY_COINS = 1000;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;

const DATA_FILE = './data.json';

// ==================================================
// データ保存
// ==================================================

let users = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        users = JSON.parse(
            fs.readFileSync(DATA_FILE, 'utf8')
        );
    } catch {
        users = {};
    }
}

function saveData() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(users, null, 2),
        'utf8'
    );
}

function getUser(userId) {
    if (!users[userId]) {
        users[userId] = {
            coins: START_COINS,
            lastDaily: 0
        };

        saveData();
    }

    return users[userId];
}

// ==================================================
// ブラックジャック
// ==================================================

const suits = [
    { symbol: '♠', code: 'S' },
    { symbol: '♥', code: 'H' },
    { symbol: '♦', code: 'D' },
    { symbol: '♣', code: 'C' }
];

const ranks = [
    { name: 'A', value: 11, code: 'A' },
    { name: '2', value: 2, code: '2' },
    { name: '3', value: 3, code: '3' },
    { name: '4', value: 4, code: '4' },
    { name: '5', value: 5, code: '5' },
    { name: '6', value: 6, code: '6' },
    { name: '7', value: 7, code: '7' },
    { name: '8', value: 8, code: '8' },
    { name: '9', value: 9, code: '9' },
    { name: '10', value: 10, code: '0' },
    { name: 'J', value: 10, code: 'J' },
    { name: 'Q', value: 10, code: 'Q' },
    { name: 'K', value: 10, code: 'K' }
];

function createDeck() {
    const deck = [];

    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({
                suit: suit.symbol,
                suitCode: suit.code,
                name: rank.name,
                rankCode: rank.code,
                value: rank.value
            });
        }
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
}

function calculateScore(hand) {
    let score = 0;
    let aces = 0;

    for (const card of hand) {
        score += card.value;

        if (card.name === 'A') {
            aces++;
        }
    }

    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }

    return score;
}

function getCardCode(card) {
    return `${card.rankCode}${card.suitCode}`;
}

function getCardImageUrl(card) {
    return `https://deckofcardsapi.com/static/img/${getCardCode(card)}.png`;
}

const BACK_IMAGE_URL =
    'https://deckofcardsapi.com/static/img/back.png';

async function downloadImage(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`画像取得失敗: ${url}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

async function resizeCard(buffer) {
    return await sharp(buffer)
        .resize({
            width: 115,
            height: 161,
            fit: 'fill'
        })
        .png()
        .toBuffer();
}

async function createCardsImage(
    dealer,
    player,
    hideDealerCard = true
) {
    const width = 600;
    const height = 170;

    const cardWidth = 115;
    const gap = 6;

    const dealerCenterX = 150;
    const playerCenterX = 450;

    const background = await sharp({
        create: {
            width,
            height,
            channels: 4,
            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0
            }
        }
    })
        .png()
        .toBuffer();

    const composites = [];

    // Dealer
    const dealerImages = [];

    for (let i = 0; i < dealer.length; i++) {
        let image;

        if (hideDealerCard && i === 1) {
            image = await downloadImage(BACK_IMAGE_URL);
        } else {
            image = await downloadImage(
                getCardImageUrl(dealer[i])
            );
        }

        dealerImages.push(
            await resizeCard(image)
        );
    }

    const dealerTotalWidth =
        dealerImages.length * cardWidth +
        (dealerImages.length - 1) * gap;

    let dealerX =
        dealerCenterX -
        dealerTotalWidth / 2;

    for (const image of dealerImages) {
        composites.push({
            input: image,
            left: Math.round(dealerX),
            top: 4
        });

        dealerX += cardWidth + gap;
    }

    // Player
    const playerImages = [];

    for (const card of player) {
        const image =
            await downloadImage(
                getCardImageUrl(card)
            );

        playerImages.push(
            await resizeCard(image)
        );
    }

    const playerTotalWidth =
        playerImages.length * cardWidth +
        (playerImages.length - 1) * gap;

    let playerX =
        playerCenterX -
        playerTotalWidth / 2;

    for (const image of playerImages) {
        composites.push({
            input: image,
            left: Math.round(playerX),
            top: 4
        });

        playerX += cardWidth + gap;
    }

    return await sharp(background)
        .composite(composites)
        .png()
        .toBuffer();
}

// ==================================================
// ブラックジャックゲーム
// ==================================================

const blackjackGames = new Map();

function createButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('blackjack_hit')
                .setLabel('ヒット')
                .setEmoji('🃏')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('blackjack_stand')
                .setLabel('スタンド')
                .setEmoji('✋')
                .setStyle(ButtonStyle.Success)
        );
}

function getResult(playerScore, dealerScore) {
    if (playerScore > 21) {
        return {
            text: '💥 **バースト！あなたの負けです！**',
            type: 'lose'
        };
    }

    if (dealerScore > 21) {
        return {
            text: '🎉 **ディーラーがバースト！あなたの勝ち！**',
            type: 'win'
        };
    }

    if (playerScore > dealerScore) {
        return {
            text: '🎉 **あなたの勝ち！**',
            type: 'win'
        };
    }

    if (playerScore < dealerScore) {
        return {
            text: '😢 **あなたの負け！**',
            type: 'lose'
        };
    }

    return {
        text: '🤝 **引き分け！**',
        type: 'draw'
    };
}

client.on(
    Events.InteractionCreate,
    async interaction => {

        try {

            console.log(
                'Interaction:',
                interaction.commandName ||
                interaction.customId
            );

            // ==================================================
            // /balance
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'balance'
            ) {
                const user =
                    getUser(interaction.user.id);

                await interaction.reply({
                    content:
                        `💰 **${interaction.user.username}** の所持コイン\n\n` +
                        `🪙 **${user.coins.toLocaleString()} コイン**`
                });

                return;
            }

            // ==================================================
            // /daily
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'daily'
            ) {
                const user =
                    getUser(interaction.user.id);

                const now = Date.now();
                const elapsed =
                    now - user.lastDaily;

                if (elapsed < DAILY_COOLDOWN) {
                    const remaining =
                        DAILY_COOLDOWN - elapsed;

                    const hours =
                        Math.floor(
                            remaining /
                            (60 * 60 * 1000)
                        );

                    const minutes =
                        Math.floor(
                            (
                                remaining %
                                (60 * 60 * 1000)
                            ) /
                            (60 * 1000)
                        );

                    await interaction.reply({
                        content:
                            `⏰ **Dailyボーナスはまだ受け取れません！**\n` +
                            `あと **${hours}時間${minutes}分** 待ってください。`,
                        ephemeral: true
                    });

                    return;
                }

                user.coins += DAILY_COINS;
                user.lastDaily = now;

                saveData();

                await interaction.reply({
                    content:
                        `🎁 **Dailyボーナス獲得！**\n\n` +
                        `🪙 +**${DAILY_COINS.toLocaleString()} コイン**\n` +
                        `💰 現在の所持コイン：**${user.coins.toLocaleString()} コイン**`
                });

                return;
            }

            // ==================================================
            // /coinflip
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'coinflip'
            ) {
                const bet =
                    interaction.options.getInteger('bet');

                const choice =
                    interaction.options.getString('choice');

                const user =
                    getUser(interaction.user.id);

                if (!bet || bet <= 0) {
                    await interaction.reply({
                        content:
                            '❌ 1コイン以上をベットしてください。',
                        ephemeral: true
                    });

                    return;
                }

                if (bet > user.coins) {
                    await interaction.reply({
                        content:
                            `❌ コインが足りません！\n` +
                            `💰 所持：**${user.coins.toLocaleString()}**\n` +
                            `🪙 ベット：**${bet.toLocaleString()}**`,
                        ephemeral: true
                    });

                    return;
                }

                const result =
                    Math.random() < 0.5
                        ? 'heads'
                        : 'tails';

                const resultText =
                    result === 'heads'
                        ? '表'
                        : '裏';

                const choiceText =
                    choice === 'heads'
                        ? '表'
                        : '裏';

                user.coins -= bet;

                if (choice === result) {
                    const payout = bet * 2;

                    user.coins += payout;
                    saveData();

                    await interaction.reply({
                        content:
                            `🪙 **コインフリップ！**\n\n` +
                            `🎯 あなたの予想：**${choiceText}**\n` +
                            `🪙 結果：**${resultText}**\n\n` +
                            `🎉 **的中！**\n` +
                            `💰 +**${bet.toLocaleString()} コイン**\n` +
                            `💵 所持コイン：**${user.coins.toLocaleString()}**`
                    });
                } else {
                    saveData();

                    await interaction.reply({
                        content:
                            `🪙 **コインフリップ！**\n\n` +
                            `🎯 あなたの予想：**${choiceText}**\n` +
                            `🪙 結果：**${resultText}**\n\n` +
                            `😢 **ハズレ！**\n` +
                            `💸 -**${bet.toLocaleString()} コイン**\n` +
                            `💵 所持コイン：**${user.coins.toLocaleString()}**`
                    });
                }

                return;
            }

            // ==================================================
            // /dice
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'dice'
            ) {
                const bet =
                    interaction.options.getInteger('bet');

                const user =
                    getUser(interaction.user.id);

                if (!bet || bet <= 0) {
                    await interaction.reply({
                        content:
                            '❌ 1コイン以上をベットしてください。',
                        ephemeral: true
                    });

                    return;
                }

                if (bet > user.coins) {
                    await interaction.reply({
                        content:
                            `❌ コインが足りません！\n` +
                            `💰 所持：**${user.coins.toLocaleString()}**\n` +
                            `🎲 ベット：**${bet.toLocaleString()}**`,
                        ephemeral: true
                    });

                    return;
                }

                const player =
                    Math.floor(Math.random() * 6) + 1;

                const dealer =
                    Math.floor(Math.random() * 6) + 1;

                user.coins -= bet;

                let resultText;

                if (player > dealer) {
                    const payout = bet * 2;

                    user.coins += payout;

                    resultText =
                        `🎉 **あなたの勝ち！**\n` +
                        `💰 +**${bet.toLocaleString()} コイン**`;

                } else if (player < dealer) {
                    resultText =
                        `😢 **あなたの負け！**\n` +
                        `💸 -**${bet.toLocaleString()} コイン**`;

                } else {
                    user.coins += bet;

                    resultText =
                        `🤝 **引き分け！**\n` +
                        `💰 ベット **${bet.toLocaleString()} コイン**返却`;
                }

                saveData();

                await interaction.reply({
                    content:
                        `🎲 **サイコロ勝負！**\n\n` +
                        `👤 あなた：**${player}**\n` +
                        `🤖 ディーラー：**${dealer}**\n\n` +
                        `${resultText}\n\n` +
                        `💵 所持コイン：**${user.coins.toLocaleString()}**`
                });

                return;
            }
                        // ==================================================
            // /slots
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'slots'
            ) {
                const bet =
                    interaction.options.getInteger('bet');

                const user =
                    getUser(interaction.user.id);

                if (!bet || bet <= 0) {
                    await interaction.reply({
                        content:
                            '❌ 1コイン以上をベットしてください。',
                        ephemeral: true
                    });

                    return;
                }

                if (bet > user.coins) {
                    await interaction.reply({
                        content:
                            `❌ コインが足りません！\n` +
                            `💰 所持：**${user.coins.toLocaleString()}**\n` +
                            `🎰 ベット：**${bet.toLocaleString()}**`,
                        ephemeral: true
                    });

                    return;
                }

                const symbols = [
                    '🍒',
                    '🍋',
                    '🍊',
                    '🍉',
                    '⭐',
                    '💎'
                ];

                const allSymbols = [
                    ...symbols,
                    '7️⃣'
                ];

                let slot1;
                let slot2;
                let slot3;

                const random = Math.random();

                // 0.1% → 777
                if (random < 0.001) {

                    slot1 = '7️⃣';
                    slot2 = '7️⃣';
                    slot3 = '7️⃣';

                // 0.9% → その他の3個ぞろい
                } else if (random < 0.01) {

                    const symbol =
                        symbols[
                            Math.floor(
                                Math.random() *
                                symbols.length
                            )
                        ];

                    slot1 = symbol;
                    slot2 = symbol;
                    slot3 = symbol;

                // 25% → 2個ぞろい
                } else if (random < 0.26) {

                    const pairSymbols = symbols;

                    const symbol =
                        pairSymbols[
                            Math.floor(
                                Math.random() *
                                pairSymbols.length
                            )
                        ];

                    const otherSymbols =
                        allSymbols.filter(
                            s => s !== symbol
                        );

                    const other =
                        otherSymbols[
                            Math.floor(
                                Math.random() *
                                otherSymbols.length
                            )
                        ];

                    const position =
                        Math.floor(
                            Math.random() * 3
                        );

                    if (position === 0) {

                        slot1 = other;
                        slot2 = symbol;
                        slot3 = symbol;

                    } else if (position === 1) {

                        slot1 = symbol;
                        slot2 = other;
                        slot3 = symbol;

                    } else {

                        slot1 = symbol;
                        slot2 = symbol;
                        slot3 = other;
                    }

                // 74% → ハズレ
                } else {

                    let shuffled;

                    do {
                        shuffled =
                            [...allSymbols]
                                .sort(
                                    () =>
                                        Math.random() -
                                        0.5
                                );

                    } while (
                        shuffled[0] === shuffled[1] ||
                        shuffled[1] === shuffled[2] ||
                        shuffled[0] === shuffled[2]
                    );

                    slot1 = shuffled[0];
                    slot2 = shuffled[1];
                    slot3 = shuffled[2];
                }

                user.coins -= bet;

                let payout = 0;
                let resultText;

                // 3個ぞろい
                if (
                    slot1 === slot2 &&
                    slot2 === slot3
                ) {

                    if (slot1 === '7️⃣') {

                        payout = bet * 10;

                        resultText =
                            `🎉🎉🎉 **JACKPOT！！** 🎉🎉🎉\n` +
                            `💰 **${payout.toLocaleString()} コイン獲得！**`;

                    } else if (slot1 === '💎') {

                        payout = bet * 7;

                        resultText =
                            `💎 **大当たり！**\n` +
                            `💰 **${payout.toLocaleString()} コイン獲得！**`;

                    } else {

                        payout = bet * 5;

                        resultText =
                            `🎉 **大当たり！**\n` +
                            `💰 **${payout.toLocaleString()} コイン獲得！**`;
                    }

                    user.coins += payout;

                // 2個ぞろい
                } else if (
                    slot1 === slot2 ||
                    slot2 === slot3 ||
                    slot1 === slot3
                ) {

                    payout = bet * 2;

                    user.coins += payout;

                    resultText =
                        `✨ **2つ揃った！**\n` +
                        `💰 **${payout.toLocaleString()} コイン獲得！**`;

                } else {

                    resultText =
                        `😢 **ハズレ！**\n` +
                        `💸 -**${bet.toLocaleString()} コイン**`;
                }

                saveData();

                await interaction.reply({
                    content:
                        `🎰 **スロット！**\n\n` +
                        `┃ ${slot1} │ ${slot2} │ ${slot3} ┃\n\n` +
                        `${resultText}\n\n` +
                        `💵 所持コイン：**${user.coins.toLocaleString()}**`
                });

                return;
            }

            // ==================================================
            // /blackjack
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'blackjack'
            ) {
                const bet =
                    interaction.options.getInteger('bet');

                const user =
                    getUser(interaction.user.id);

                if (!bet || bet <= 0) {
                    await interaction.reply({
                        content:
                            '❌ 1コイン以上をベットしてください。',
                        ephemeral: true
                    });

                    return;
                }

                if (bet > user.coins) {
                    await interaction.reply({
                        content:
                            `❌ コインが足りません！\n` +
                            `💰 所持：**${user.coins.toLocaleString()}**\n` +
                            `🎲 ベット：**${bet.toLocaleString()}**`,
                        ephemeral: true
                    });

                    return;
                }

                if (
                    blackjackGames.has(
                        interaction.user.id
                    )
                ) {
                    await interaction.reply({
                        content:
                            '⚠️ すでにブラックジャックをプレイ中です！',
                        ephemeral: true
                    });

                    return;
                }

                user.coins -= bet;
                saveData();

                const deck = createDeck();

                const player = [
                    deck.pop(),
                    deck.pop()
                ];

                const dealer = [
                    deck.pop(),
                    deck.pop()
                ];

                blackjackGames.set(
                    interaction.user.id,
                    {
                        deck,
                        player,
                        dealer,
                        bet
                    }
                );

                const playerScore =
                    calculateScore(player);

                const dealerScore =
                    calculateScore([
                        dealer[0]
                    ]);

                const cardsImage =
                    await createCardsImage(
                        dealer,
                        player,
                        true
                    );

                const attachment =
                    new AttachmentBuilder(
                        cardsImage,
                        {
                            name: 'cards.png'
                        }
                    );

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            '🃏 ブラックジャック'
                        )
                        .addFields(
                            {
                                name:
                                    `🎩 Dealer [${dealerScore}]`,
                                value: '\u200B',
                                inline: true
                            },
                            {
                                name:
                                    `👤 ${interaction.user.username} [${playerScore}]`,
                                value: '\u200B',
                                inline: true
                            },
                            {
                                name: '💰 ベット',
                                value:
                                    `**${bet.toLocaleString()} コイン**`,
                                inline: false
                            }
                        )
                        .setImage(
                            'attachment://cards.png'
                        )
                        .setFooter({
                            text:
                                '🃏 ヒットでカードを引く　｜　✋ スタンドで勝負'
                        });

                await interaction.reply({
                    embeds: [embed],
                    files: [attachment],
                    components: [
                        createButtons()
                    ]
                });

                return;
            }

            // ==================================================
            // ブラックジャックボタン
            // ==================================================

            if (interaction.isButton()) {

                if (
                    interaction.customId !==
                        'blackjack_hit' &&
                    interaction.customId !==
                        'blackjack_stand'
                ) {
                    return;
                }

                const game =
                    blackjackGames.get(
                        interaction.user.id
                    );

                if (!game) {
                    await interaction.reply({
                        content:
                            '❌ ゲームが見つかりません。`/blackjack` で新しく始めてください。',
                        ephemeral: true
                    });

                    return;
                }

                // ==================================================
                // HIT
                // ==================================================

                if (
                    interaction.customId ===
                    'blackjack_hit'
                ) {

                    game.player.push(
                        game.deck.pop()
                    );

                    const playerScore =
                        calculateScore(
                            game.player
                        );

                    if (playerScore > 21) {

                        const dealerScore =
                            calculateScore(
                                game.dealer
                            );

                        blackjackGames.delete(
                            interaction.user.id
                        );

                        const cardsImage =
                            await createCardsImage(
                                game.dealer,
                                game.player,
                                false
                            );

                        const attachment =
                            new AttachmentBuilder(
                                cardsImage,
                                {
                                    name: 'cards.png'
                                }
                            );

                        const embed =
                            new EmbedBuilder()
                                .setTitle(
                                    '🃏 ブラックジャック 結果'
                                )
                                .addFields(
                                    {
                                        name:
                                            `🎩 Dealer [${dealerScore}]`,
                                        value: '\u200B',
                                        inline: true
                                    },
                                    {
                                        name:
                                            `👤 ${interaction.user.username} [${playerScore}]`,
                                        value: '\u200B',
                                        inline: true
                                    },
                                    {
                                        name: '💰 ベット',
                                        value:
                                            `**${game.bet.toLocaleString()} コイン**`,
                                        inline: false
                                    },
                                    {
                                        name: '🏆 結果',
                                        value:
                                            '💥 **バースト！あなたの負けです！**\n' +
                                            `💸 **-${game.bet.toLocaleString()} コイン**`,
                                        inline: false
                                    }
                                )
                                .setImage(
                                    'attachment://cards.png'
                                );

                        await interaction.update({
                            embeds: [embed],
                            files: [attachment],
                            components: []
                        });

                        return;
                    }

                    const dealerScore =
                        calculateScore([
                            game.dealer[0]
                        ]);

                    const cardsImage =
                        await createCardsImage(
                            game.dealer,
                            game.player,
                            true
                        );

                    const attachment =
                        new AttachmentBuilder(
                            cardsImage,
                            {
                                name: 'cards.png'
                            }
                        );

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                '🃏 ブラックジャック'
                            )
                            .addFields(
                                {
                                    name:
                                        `🎩 Dealer [${dealerScore}]`,
                                    value: '\u200B',
                                    inline: true
                                },
                                {
                                    name:
                                        `👤 ${interaction.user.username} [${playerScore}]`,
                                    value: '\u200B',
                                    inline: true
                                },
                                {
                                    name: '💰 ベット',
                                    value:
                                        `**${game.bet.toLocaleString()} コイン**`,
                                    inline: false
                                }
                            )
                            .setImage(
                                'attachment://cards.png'
                            )
                            .setFooter({
                                text:
                                    '🃏 ヒットでカードを引く　｜　✋ スタンドで勝負'
                            });

                    await interaction.update({
                        embeds: [embed],
                        files: [attachment],
                        components: [
                            createButtons()
                        ]
                    });

                    return;
                }
                                // ==================================================
                // STAND
                // ==================================================

                if (
                    interaction.customId ===
                    'blackjack_stand'
                ) {

                    // ディーラーが17以上になるまで引く
                    while (
                        calculateScore(
                            game.dealer
                        ) < 17
                    ) {
                        game.dealer.push(
                            game.deck.pop()
                        );
                    }

                    const playerScore =
                        calculateScore(
                            game.player
                        );

                    const dealerScore =
                        calculateScore(
                            game.dealer
                        );

                    let resultText;
                    let payout = 0;

                    const user =
                        getUser(
                            interaction.user.id
                        );

                    // ==================================================
                    // 勝敗判定
                    // ==================================================

                    if (dealerScore > 21) {

                        // ディーラーがバースト
                        payout =
                            game.bet * 2;

                        user.coins += payout;

                        resultText =
                            `🎉 **ディーラーがバースト！あなたの勝ち！**\n` +
                            `💰 **+${payout.toLocaleString()} コイン**`;

                    } else if (
                        playerScore > dealerScore
                    ) {

                        // プレイヤー勝利
                        payout =
                            game.bet * 2;

                        user.coins += payout;

                        resultText =
                            `🎉 **あなたの勝ち！**\n` +
                            `💰 **+${payout.toLocaleString()} コイン**`;

                    } else if (
                        playerScore === dealerScore
                    ) {

                        // 引き分け
                        payout =
                            game.bet;

                        user.coins += payout;

                        resultText =
                            `🤝 **引き分け！**\n` +
                            `💰 ベットがそのまま返ってきました！`;

                    } else {

                        // プレイヤー敗北
                        resultText =
                            `😢 **あなたの負け……**\n` +
                            `💸 **-${game.bet.toLocaleString()} コイン**`;
                    }

                    blackjackGames.delete(
                        interaction.user.id
                    );

                    saveData();

                    const cardsImage =
                        await createCardsImage(
                            game.dealer,
                            game.player,
                            false
                        );

                    const attachment =
                        new AttachmentBuilder(
                            cardsImage,
                            {
                                name: 'cards.png'
                            }
                        );

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                '🃏 ブラックジャック 結果'
                            )
                            .addFields(
                                {
                                    name:
                                        `🎩 Dealer [${dealerScore}]`,
                                    value: '\u200B',
                                    inline: true
                                },
                                {
                                    name:
                                        `👤 ${interaction.user.username} [${playerScore}]`,
                                    value: '\u200B',
                                    inline: true
                                },
                                {
                                    name: '💰 ベット',
                                    value:
                                        `**${game.bet.toLocaleString()} コイン**`,
                                    inline: false
                                },
                                {
                                    name: '🏆 結果',
                                    value:
                                        resultText,
                                    inline: false
                                },
                                {
                                    name: '💵 現在の所持コイン',
                                    value:
                                        `**${user.coins.toLocaleString()} コイン**`,
                                    inline: false
                                }
                            )
                            .setImage(
                                'attachment://cards.png'
                            );

                    await interaction.update({
                        embeds: [embed],
                        files: [attachment],
                        components: []
                    });

                    return;
                }
            }

        } catch (error) {

            console.error(
                'エラー:',
                error
            );

            try {

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content:
                            '❌ エラーが発生しました。',
                        ephemeral: true
                    });

                } else {

                    await interaction.reply({
                        content:
                            '❌ エラーが発生しました。',
                        ephemeral: true
                    });
                }

            } catch (replyError) {

                console.error(
                    'エラー返信にも失敗:',
                    replyError
                );
            }
        }
    }
);

// ==================================================
// Render用 HTTPサーバー
// ==================================================

const PORT =
    process.env.PORT || 10000;

http.createServer(
    (req, res) => {

        res.writeHead(
            200,
            {
                'Content-Type':
                    'text/plain; charset=utf-8'
            }
        );

        res.end(
            'Discord bot is running!'
        );
    }
).listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            `HTTP server listening on port ${PORT}`
        );
    }
);

// ==================================================
// Login
// ==================================================

client.login(
    process.env.TOKEN
);