// Exercises the shipped progress window without extracting or installing a payload.
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define NOMINMAX
#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <vector>

extern "C" __declspec(dllimport) HRESULT __cdecl InstallerApplyFrame(HWND window);
extern "C" __declspec(dllimport) HWND __cdecl InstallerShowProgress(HWND parent, HWND source,
    BOOL dark, UINT dpi, const WCHAR* brand, const WCHAR* preparing, const WCHAR* extracting,
    const WCHAR* copying, const WCHAR* registering, const WCHAR* cleaning);
extern "C" __declspec(dllimport) BOOL __cdecl InstallerFinishProgress(HWND window);

static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wparam, lparam);
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "Usage: render-test.exe <brand.bmp> <dpi> [light|dark] [interactive-title]\n");
        return 1;
    }
    const int dpi = _wtoi(argv[2]);
    if (dpi < 96 || dpi > 384) return 2;
    const bool dark = argc > 3 && wcscmp(argv[3], L"dark") == 0;
    const bool interactive = argc > 4;
    SetProcessDPIAware();
    WNDCLASSW type = {};
    type.lpfnWndProc = WindowProc;
    type.hInstance = GetModuleHandleW(nullptr);
    type.lpszClassName = L"HarnessInstallerRenderTest";
    type.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    if (!RegisterClassW(&type)) return 3;
    HWND window = CreateWindowW(type.lpszClassName, interactive ? argv[4] : L"Installer rendering test",
        WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX, 100, 100, MulDiv(600, dpi, 96), MulDiv(600, dpi, 96),
        nullptr, nullptr, type.hInstance, nullptr);
    if (!window || FAILED(InstallerApplyFrame(window))) return 4;
    HWND stock = CreateWindowW(L"STATIC", L"", WS_CHILD, 0, 0, 1, 1, window, nullptr, type.hInstance, nullptr);
    HWND source = CreateWindowW(L"STATIC", L"", WS_CHILD, 0, 0, 1, 1, stock, nullptr, type.hInstance, nullptr);
    SetPropW(window, L"HarnessInstaller.Stage", reinterpret_cast<HANDLE>(1));
    SetPropW(window, L"HarnessInstaller.ExtractProgress", reinterpret_cast<HANDLE>(50));
    const auto createProgress = [&]() {
        return InstallerShowProgress(window, source, dark, static_cast<UINT>(dpi), argv[1],
            L"Preparing %d%%", L"Extracting %d%%", L"Copying %d%%", L"Registering %d%%", L"Cleaning %d%%");
    };
    ShowWindow(window, SW_SHOWNOACTIVATE);
    // Warm retained font and window-animation resources before checking page-owned GDI objects.
    HWND warmup = createProgress();
    if (!warmup) { DestroyWindow(window); return 5; }
    UpdateWindow(warmup);
    ShowWindow(window, SW_MINIMIZE);
    ShowWindow(window, SW_RESTORE);
    UpdateWindow(warmup);
    DestroyWindow(warmup);
    const DWORD initialGdi = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
    HWND progress = createProgress();
    if (!progress) { DestroyWindow(window); return 5; }
    UpdateWindow(progress);
    if (interactive) {
        MSG message;
        BOOL result;
        while ((result = GetMessageW(&message, nullptr, 0, 0)) > 0) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        return result == 0 ? 0 : 7;
    }
    RECT originalBounds, restoredBounds;
    GetWindowRect(window, &originalBounds);
    const auto captionPixel = [&](int x) {
        UpdateWindow(progress);
        HDC dc = GetDC(progress);
        const COLORREF pixel = GetPixel(dc, MulDiv(x + 8, dpi, 96), MulDiv(24, dpi, 96));
        ReleaseDC(progress, dc);
        return pixel;
    };
    const COLORREF normalColor = dark ? RGB(21, 21, 23) : RGB(255, 255, 255);
    const COLORREF hoverColor = dark ? RGB(48, 48, 52) : RGB(238, 240, 242);
    const COLORREF pressedColor = dark ? RGB(69, 69, 75) : RGB(212, 219, 233);
    bool captionStates = true;
    for (int x : {504, 548}) {
        const LPARAM point = MAKELPARAM(MulDiv(x + 20, dpi, 96), MulDiv(24, dpi, 96));
        captionStates = captionStates && captionPixel(x) == normalColor;
        SendMessageW(progress, WM_MOUSEMOVE, 0, point);
        captionStates = captionStates && captionPixel(x) == hoverColor;
        SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, point);
        captionStates = captionStates && captionPixel(x) == pressedColor;
        SendMessageW(progress, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(-1, -1));
        captionStates = captionStates && captionPixel(x) == normalColor;
        SendMessageW(progress, WM_MOUSEMOVE, MK_LBUTTON, point);
        captionStates = captionStates && captionPixel(x) == pressedColor;
        SendMessageW(progress, WM_CANCELMODE, 0, 0);
        captionStates = captionStates && captionPixel(x) == hoverColor;
        SendMessageW(progress, WM_MOUSELEAVE, 0, 0);
        captionStates = captionStates && captionPixel(x) == normalColor;
    }
    const LPARAM minimizePoint = MAKELPARAM(MulDiv(524, dpi, 96), MulDiv(24, dpi, 96));
    SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, minimizePoint);
    bool buttonRelease = !IsIconic(window) && GetCapture() == progress;
    SendMessageW(progress, WM_LBUTTONUP, 0, MAKELPARAM(-1, -1));
    buttonRelease = buttonRelease && !IsIconic(window) && GetCapture() != progress;
    SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, minimizePoint);
    ReleaseCapture();
    SendMessageW(progress, WM_LBUTTONUP, 0, minimizePoint);
    buttonRelease = buttonRelease && !IsIconic(window);
    SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, minimizePoint);
    SendMessageW(progress, WM_CANCELMODE, 0, 0);
    SendMessageW(progress, WM_LBUTTONUP, 0, minimizePoint);
    buttonRelease = buttonRelease && !IsIconic(window) && GetCapture() != progress;
    SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, minimizePoint);
    SendMessageW(progress, WM_LBUTTONUP, 0, minimizePoint);
    const bool minimized = IsIconic(window) != FALSE;
    ShowWindow(window, SW_RESTORE);
    GetWindowRect(window, &restoredBounds);
    const bool restored = !IsIconic(window) && EqualRect(&originalBounds, &restoredBounds);
    const LPARAM closePoint = MAKELPARAM(MulDiv(568, dpi, 96), MulDiv(24, dpi, 96));
    MSG closeMessage;
    SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, closePoint);
    bool closeRelease = !PeekMessageW(&closeMessage, window, WM_CLOSE, WM_CLOSE, PM_REMOVE);
    SendMessageW(progress, WM_LBUTTONUP, 0, minimizePoint);
    closeRelease = closeRelease && !PeekMessageW(&closeMessage, window, WM_CLOSE, WM_CLOSE, PM_REMOVE);
    SendMessageW(progress, WM_LBUTTONDOWN, MK_LBUTTON, closePoint);
    SendMessageW(progress, WM_LBUTTONUP, 0, closePoint);
    closeRelease = closeRelease && PeekMessageW(&closeMessage, window, WM_CLOSE, WM_CLOSE, PM_REMOVE);
    LARGE_INTEGER frequency, started, finished;
    QueryPerformanceFrequency(&frequency);
    std::vector<double> samples;
    // Full repaint is the exposure/restore path; fixture startup is excluded.
    for (int frame = 0; frame < 300; ++frame) {
        InvalidateRect(progress, nullptr, FALSE);
        QueryPerformanceCounter(&started);
        UpdateWindow(progress);
        QueryPerformanceCounter(&finished);
        samples.push_back(1000.0 * (finished.QuadPart - started.QuadPart) / frequency.QuadPart);
    }
    double total = 0;
    for (double sample : samples) total += sample;
    std::printf("samples_ms=[");
    for (size_t index = 0; index < samples.size(); ++index) {
        std::printf("%s%.3f", index ? "," : "", samples[index]);
    }
    std::printf("]\n");
    std::sort(samples.begin(), samples.end());
    std::printf("dpi=%d dark=%d frames=300 mean_ms=%.3f p50_ms=%.3f p95_ms=%.3f max_ms=%.3f\n",
        dpi, dark, total / samples.size(), samples[150], samples[285], samples.back());
    const bool completed = InstallerFinishProgress(progress) &&
        GetPropW(window, L"HarnessInstaller.CompletedPercent") == reinterpret_cast<HANDLE>(100);
    WCHAR caption[160] = {};
    GetWindowTextW(progress, caption, ARRAYSIZE(caption));
    const bool finalCaption = wcscmp(caption, L"Extracting 100%") == 0;
    DestroyWindow(progress);
    const DWORD finalGdi = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
    DestroyWindow(window);
    std::printf("completed=%d final_caption=%d caption_states=%d button_release=%d close_release=%d minimized=%d restored=%d gdi_before=%lu gdi_after=%lu\n",
        completed, finalCaption, captionStates, buttonRelease, closeRelease, minimized, restored, initialGdi, finalGdi);
    return completed && finalCaption && captionStates && buttonRelease && closeRelease && minimized && restored && finalGdi <= initialGdi ? 0 : 6;
}
