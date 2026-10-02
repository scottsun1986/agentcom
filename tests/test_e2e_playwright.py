import pytest
from playwright.async_api import async_playwright

@pytest.mark.asyncio
async def test_full_playwright_e2e():
    page_errors = []
    console_errors = []
    failed_requests = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("response", lambda resp: failed_requests.append(f"{resp.status} {resp.url}") if resp.status >= 400 else None)

        # 1. Access root URL (should redirect to #/login smoothly)
        await page.goto("http://127.0.0.1:8009/", wait_until="networkidle")
        await page.wait_for_timeout(500)
        assert "/login" in page.url

        # 2. Login
        captcha_el = await page.wait_for_selector(".lr-captcha", timeout=5000)
        captcha_text = "".join((await captcha_el.inner_text()).split())
        await page.fill('input[placeholder="请输入账号"]', "admin")
        await page.fill('input[placeholder="请输入密码"]', "admin123")
        await page.fill('input[placeholder="请输入验证码"]', captcha_text)
        await page.click("button.lr-btn")
        await page.wait_for_timeout(1000)

        assert "/portal/overview" in page.url, f"Expected portal overview, got {page.url}"

        # 3. Verify Top Navigation Bar & Sidebar
        categories = await page.evaluate("() => window.AppCatalog.categories")
        assert len(categories) == 11, f"Expected 11 categories, got {len(categories)}"

        visited_count = 0
        unregistered_pages = []

        for cat in categories:
            for p_info in cat["pages"]:
                route = p_info["route"]
                title = p_info["title"]
                await page.evaluate(f'window.App.go("{route}")')
                await page.wait_for_timeout(150)
                body_text = await page.inner_text(".main")
                if "页面未注册" in body_text:
                    unregistered_pages.append(f"{route} ({title})")
                else:
                    visited_count += 1

        assert len(unregistered_pages) == 0, f"Unregistered pages: {unregistered_pages}"
        assert visited_count == 81, f"Expected 81 visited pages, got {visited_count}"

        # 4. Verify AI Assistant interaction
        await page.click(".ai-launcher")
        await page.wait_for_timeout(300)
        assert await page.is_visible(".ai-panel")

        await page.fill(".ai-panel input", "查询督办预警")
        await page.click('.ai-panel button:has-text("发送")')
        await page.wait_for_timeout(1200)

        ai_msgs_text = await page.inner_text(".ai-panel .msgs")
        assert ("督办" in ai_msgs_text) or ("预警" in ai_msgs_text)

        # 5. Check watermark
        watermark = await page.query_selector(".watermark-layer")
        assert watermark is not None

        # 6. Verify zero runtime page errors
        assert len(page_errors) == 0, f"Page errors encountered: {page_errors}"
        assert len(console_errors) == 0, f"Console errors: {console_errors}"
        # All failed requests should be zero
        assert len(failed_requests) == 0, f"Failed HTTP requests: {failed_requests}"

        await browser.close()
