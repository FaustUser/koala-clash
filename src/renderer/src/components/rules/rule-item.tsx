import { Card, CardContent } from '@renderer/components/ui/card'
import React from 'react'

const RuleItem: React.FC<ControllerRulesDetail & { index: number }> = (props) => {
  const { type, payload, proxy, index } = props
  return (
    <div className={`w-full px-2 pb-2 ${index === 0 ? 'pt-2' : ''}`}>
      <Card className="gap-0 py-0">
        <CardContent className="w-full px-3 py-2">
          <div title={payload} className="text-ellipsis whitespace-nowrap overflow-hidden">
            {payload}
          </div>
          <div className="flex justify-start text-muted-foreground">
            <div>{type}</div>
            <div className="ml-2">{proxy}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default RuleItem
