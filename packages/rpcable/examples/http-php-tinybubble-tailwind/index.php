<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>rpcable HTTP PHP + TinyBubble + Tailwind</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            tailwind.config = {
                theme: {
                    extend: {
                        fontFamily: {
                            display: ['Space Grotesk', 'sans-serif'],
                            mono: ['IBM Plex Mono', 'monospace'],
                        },
                        colors: {
                            ember: '#c2410c',
                            pine: '#0f766e',
                            dusk: '#1e293b',
                            cream: '#fff7ed',
                        },
                        boxShadow: {
                            panel: '0 30px 80px rgba(15, 23, 42, 0.18)',
                        },
                    },
                },
            };
        </script>
    </head>
    <body class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.25),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(45,212,191,0.28),_transparent_24%),linear-gradient(135deg,_#fff7ed_0%,_#fffbeb_32%,_#ecfeff_100%)] font-display text-dusk">
        <div id="app" class="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8"></div>
        <script type="module" src="./main.js"></script>
    </body>
    </html>
