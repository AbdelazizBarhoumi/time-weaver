<?php

namespace App\Http\Controllers;

use App\Models\ReportSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ReportSettingController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(ReportSetting::forUser($request->user())->toApi());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'companyName' => ['sometimes', 'nullable', 'string', 'max:160'],
            'preparedBy' => ['sometimes', 'nullable', 'string', 'max:160'],
            'footerText' => ['sometimes', 'nullable', 'string', 'max:500'],
            'accentColor' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'logo' => ['sometimes', 'nullable', 'file', 'mimes:png,jpg,jpeg', 'max:2048', 'dimensions:max_width=2000,max_height=2000'],
            'removeLogo' => ['sometimes', 'boolean'],
        ]);

        $setting = ReportSetting::forUser($request->user());
        $oldLogo = $setting->logo_path;
        $newLogo = null;

        if ($request->hasFile('logo')) {
            $newLogo = $request->file('logo')->store('report-logos', 'local');
        }

        $setting->fill([
            'company_name' => array_key_exists('companyName', $data) ? $data['companyName'] : $setting->company_name,
            'prepared_by' => array_key_exists('preparedBy', $data) ? $data['preparedBy'] : $setting->prepared_by,
            'footer_text' => array_key_exists('footerText', $data) ? $data['footerText'] : $setting->footer_text,
            'accent_color' => array_key_exists('accentColor', $data) ? $data['accentColor'] : $setting->accent_color,
        ]);

        if ($newLogo !== null) {
            $setting->logo_path = $newLogo;
        } elseif ($request->boolean('removeLogo')) {
            $setting->logo_path = null;
        }

        $setting->save();

        if ($oldLogo !== null && $oldLogo !== $setting->logo_path) {
            Storage::disk('local')->delete($oldLogo);
        }

        return response()->json($setting->fresh()->toApi());
    }
}
