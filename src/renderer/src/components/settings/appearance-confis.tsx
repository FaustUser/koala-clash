import React, { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Input } from '@renderer/components/ui/input'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  applyTheme,
  closeFloatingWindow,
  closeTrayIcon,
  fetchThemes,
  getFilePath,
  importThemes,
  isAlwaysOnTop,
  relaunchApp,
  resolveThemes,
  setAlwaysOnTop,
  setDockVisible,
  showFloatingWindow,
  showTrayIcon,
  writeTheme
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { useTheme } from 'next-themes'
import CSSEditorModal from './css-editor-modal'
import { useTranslation } from 'react-i18next'
import { CloudDownload, FilePenLine, Import, MessageCircleQuestionMark } from 'lucide-react'

interface AppearanceConfigProps {
  showHiddenSettings: boolean
}

const MIN_FLOATING_WINDOW_WIDTH = 88
const MAX_FLOATING_WINDOW_WIDTH = 400
const MIN_FLOATING_WINDOW_HEIGHT = 32
const MAX_FLOATING_WINDOW_HEIGHT = 160

function clampDimension(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

const AppearanceConfig: React.FC<AppearanceConfigProps> = (props) => {
  const { showHiddenSettings } = props
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const [customThemes, setCustomThemes] = useState<{ key: string; label: string }[]>()
  const [openCSSEditor, setOpenCSSEditor] = useState(false)
  const [fetching, setFetching] = useState(false)
  const { setTheme } = useTheme()
  const {
    useDockIcon = true,
    proxyInTray = true,
    disableTray = false,
    showFloatingWindow: showFloating = false,
    spinFloatingIcon = true,
    floatingWindowSize = 'default',
    floatingWindowUseCustomSize = false,
    floatingWindowWidth = 120,
    floatingWindowHeight = 42,
    useWindowFrame = false,
    customTheme = 'default.css',
    appTheme = 'system'
  } = appConfig || {}
  const [localShowFloating, setLocalShowFloating] = useState(showFloating)
  const [customWidth, setCustomWidth] = useState(floatingWindowWidth.toString())
  const [customHeight, setCustomHeight] = useState(floatingWindowHeight.toString())
  const [onTop, setOnTop] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setLocalShowFloating(showFloating)
  }, [showFloating])

  useEffect(() => {
    setCustomWidth(floatingWindowWidth.toString())
    setCustomHeight(floatingWindowHeight.toString())
  }, [floatingWindowHeight, floatingWindowWidth])

  useEffect(() => {
    resolveThemes().then((themes) => {
      setCustomThemes(themes)
    })
    isAlwaysOnTop().then(setOnTop)
  }, [])

  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const updateCustomDimension = async (
    rawValue: string,
    fallbackValue: number,
    min: number,
    max: number,
    configKey: 'floatingWindowWidth' | 'floatingWindowHeight',
    setValue: (value: string) => void
  ): Promise<void> => {
    const parsedValue = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsedValue)
      ? clampDimension(parsedValue, min, max)
      : fallbackValue

    setValue(nextValue.toString())
    await patchAppConfig({ [configKey]: nextValue })
    window.electron.ipcRenderer.send('updateFloatingWindow')
  }

  return (
    <>
      {openCSSEditor && (
        <CSSEditorModal
          theme={customTheme}
          onCancel={() => setOpenCSSEditor(false)}
          onConfirm={async (css: string) => {
            await writeTheme(customTheme, css)
            await applyTheme(customTheme)
            setOpenCSSEditor(false)
          }}
        />
      )}
      <SettingCard title={t('settings.appearance.title')}>
        <SettingItem
          title={t('settings.appearance.showFloatingWindow')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <MessageCircleQuestionMark className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.appearance.showFloatingWindowHelp')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Switch
            checked={localShowFloating}
            onCheckedChange={async (value) => {
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
                timeoutRef.current = null
              }

              setLocalShowFloating(value)
              if (value) {
                await showFloatingWindow()
                timeoutRef.current = setTimeout(async () => {
                  await patchAppConfig({ showFloatingWindow: value })
                  timeoutRef.current = null
                }, 1000)
              } else {
                patchAppConfig({ showFloatingWindow: value })
                await closeFloatingWindow()
              }
            }}
          />
        </SettingItem>
        {localShowFloating && (
          <SettingItem title={t('settings.appearance.floatingWindowSize')} divider>
            <Select
              value={floatingWindowSize}
              onValueChange={async (value) => {
                await patchAppConfig({
                  floatingWindowSize: value as NonNullable<AppConfig['floatingWindowSize']>
                })
                window.electron.ipcRenderer.send('updateFloatingWindow')
              }}
            >
              <SelectTrigger size="sm" className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">
                  {t('settings.appearance.floatingWindowSizeSmall')}
                </SelectItem>
                <SelectItem value="default">
                  {t('settings.appearance.floatingWindowSizeDefault')}
                </SelectItem>
                <SelectItem value="large">
                  {t('settings.appearance.floatingWindowSizeLarge')}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingItem>
        )}
        {localShowFloating && (
          <SettingItem title={t('settings.appearance.useCustomFloatingWindowSize')} divider>
            <Switch
              checked={floatingWindowUseCustomSize}
              onCheckedChange={async (value) => {
                await patchAppConfig({ floatingWindowUseCustomSize: value })
                window.electron.ipcRenderer.send('updateFloatingWindow')
              }}
            />
          </SettingItem>
        )}
        {localShowFloating && floatingWindowUseCustomSize && (
          <SettingItem
            title={t('settings.appearance.customFloatingWindowSize')}
            actions={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost">
                    <MessageCircleQuestionMark className="text-lg" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-72 leading-relaxed">
                  {t('settings.appearance.customFloatingWindowSizeHelp', {
                    minWidth: MIN_FLOATING_WINDOW_WIDTH,
                    minHeight: MIN_FLOATING_WINDOW_HEIGHT
                  })}
                </TooltipContent>
              </Tooltip>
            }
            divider
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={MIN_FLOATING_WINDOW_WIDTH.toString()}
                max={MAX_FLOATING_WINDOW_WIDTH.toString()}
                className="w-[110px] h-8"
                value={customWidth}
                placeholder={t('settings.appearance.width')}
                onChange={(event) => {
                  setCustomWidth(event.target.value)
                }}
                onBlur={async () => {
                  await updateCustomDimension(
                    customWidth,
                    floatingWindowWidth,
                    MIN_FLOATING_WINDOW_WIDTH,
                    MAX_FLOATING_WINDOW_WIDTH,
                    'floatingWindowWidth',
                    setCustomWidth
                  )
                }}
              />
              <Input
                type="number"
                min={MIN_FLOATING_WINDOW_HEIGHT.toString()}
                max={MAX_FLOATING_WINDOW_HEIGHT.toString()}
                className="w-[110px] h-8"
                value={customHeight}
                placeholder={t('settings.appearance.height')}
                onChange={(event) => {
                  setCustomHeight(event.target.value)
                }}
                onBlur={async () => {
                  await updateCustomDimension(
                    customHeight,
                    floatingWindowHeight,
                    MIN_FLOATING_WINDOW_HEIGHT,
                    MAX_FLOATING_WINDOW_HEIGHT,
                    'floatingWindowHeight',
                    setCustomHeight
                  )
                }}
              />
            </div>
          </SettingItem>
        )}
        {localShowFloating && (
          <SettingItem title={t('settings.appearance.rotateFloatingIcon')} divider>
            <Switch
              checked={spinFloatingIcon}
              onCheckedChange={async (value) => {
                await patchAppConfig({ spinFloatingIcon: value })
                window.electron.ipcRenderer.send('updateFloatingWindow')
              }}
            />
          </SettingItem>
        )}
        <SettingItem title={t('settings.appearance.disableTrayIcon')} divider>
          <Switch
            checked={disableTray}
            onCheckedChange={async (value) => {
              await patchAppConfig({ disableTray: value })
              if (value) {
                closeTrayIcon()
              } else {
                showTrayIcon()
              }
            }}
          />
        </SettingItem>
        {platform !== 'linux' && (
          <>
            <SettingItem title={t('settings.appearance.trayShowNodeInfo')} divider>
              <Switch
                checked={proxyInTray}
                onCheckedChange={async (value) => {
                  await patchAppConfig({ proxyInTray: value })
                }}
              />
            </SettingItem>
          </>
        )}
        {platform === 'darwin' && (
          <>
            <SettingItem title={t('settings.appearance.showDockIcon')} divider>
              <Switch
                checked={useDockIcon}
                onCheckedChange={async (value) => {
                  await patchAppConfig({ useDockIcon: value })
                  setDockVisible(value)
                }}
              />
            </SettingItem>
          </>
        )}
        <SettingItem title={t('settings.appearance.alwaysOnTop')} divider>
          <Switch
            checked={onTop}
            onCheckedChange={async (value) => {
              await setAlwaysOnTop(value)
              setOnTop(await isAlwaysOnTop())
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.appearance.useSystemTitleBar')} divider>
          <Switch
            checked={useWindowFrame}
            onCheckedChange={async (value) => {
              await patchAppConfig({ useWindowFrame: value })
              await relaunchApp()
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.appearance.backgroundColor')} divider={showHiddenSettings}>
          <Tabs
            value={appTheme}
            onValueChange={(value) => {
              setTheme(value)
              patchAppConfig({ appTheme: value as AppTheme })
            }}
          >
            <TabsList>
              <TabsTrigger value="system">{t('settings.appearance.auto')}</TabsTrigger>
              <TabsTrigger value="dark">{t('settings.appearance.dark')}</TabsTrigger>
              <TabsTrigger value="light">{t('settings.appearance.light')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </SettingItem>
        {showHiddenSettings && (
          <SettingItem
            title={t('settings.appearance.theme')}
            actions={
              <>
                <Button
                  size="icon-sm"
                  title={t('settings.appearance.pullTheme')}
                  variant="ghost"
                  disabled={fetching}
                  onClick={async () => {
                    setFetching(true)
                    try {
                      await fetchThemes()
                      setCustomThemes(await resolveThemes())
                    } catch (e) {
                      toast.error(`${e}`)
                    } finally {
                      setFetching(false)
                    }
                  }}
                >
                  {fetching ? (
                    <Spinner className="text-lg" />
                  ) : (
                    <CloudDownload className="text-lg" />
                  )}
                </Button>
                <Button
                  size="icon-sm"
                  title={t('settings.appearance.importTheme')}
                  variant="ghost"
                  onClick={async () => {
                    const files = await getFilePath(['css'])
                    if (!files) return
                    try {
                      await importThemes(files)
                      setCustomThemes(await resolveThemes())
                    } catch (e) {
                      toast.error(`${e}`)
                    }
                  }}
                >
                  <Import className="text-lg" />
                </Button>
                <Button
                  size="icon-sm"
                  title={t('settings.appearance.editTheme')}
                  variant="ghost"
                  onClick={async () => {
                    setOpenCSSEditor(true)
                  }}
                >
                  <FilePenLine className="text-lg" />
                </Button>
              </>
            }
          >
            {customThemes && (
              <Select
                value={customTheme}
                onValueChange={async (value) => {
                  try {
                    await patchAppConfig({ customTheme: value })
                  } catch (e) {
                    toast.error(`${e}`)
                  }
                }}
              >
                <SelectTrigger size="sm" className="w-[60%]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customThemes.map((theme) => (
                    <SelectItem key={theme.key} value={theme.key}>
                      {theme.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingItem>
        )}
      </SettingCard>
    </>
  )
}

export default AppearanceConfig
