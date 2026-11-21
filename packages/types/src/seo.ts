/**
 * IndexNow (indexnow.org): the protocol Bing, Yandex, Seznam and Naver share to hear about a new
 * or changed page at once instead of on their next crawl. Bing's index is the one ChatGPT search
 * and Copilot answer from, so this is how a new business site reaches them in days, not weeks.
 *
 * The key is public by design: each host serves it at /indexnow.txt to prove the submitter owns
 * the host (apps/web and apps/storefront both do). It authorises nothing but "please recrawl
 * these URLs of mine". ops/indexnow.sh submits the sitemaps with it.
 */
export const INDEXNOW_KEY = "8fd050634d39acd4755fb58da6c03c4b";
