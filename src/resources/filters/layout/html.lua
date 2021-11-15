-- html.lua
-- Copyright (C) 2020 by RStudio, PBC

function htmlPanel(divEl, layout, caption)
  
  -- outer panel to contain css and figure panel
  local panel = pandoc.Div({}, pandoc.Attr(divEl.attr.id, divEl.attr.classes))
  panel.attr.classes:insert("quarto-layout-panel")
  
  -- enclose in figure if it's a figureRef
  if hasFigureRef(divEl) then
    panel.content:insert(pandoc.RawBlock("html", "<figure>"))
  end

  -- compute vertical alignment and remove attribute
  local vAlign = validatedVAlign(divEl.attr.attributes[kLayoutVAlign])
  local vAlignClass = vAlignClass(vAlign);
  divEl.attr.attributes[kLayoutVAlign] = nil
  
  -- layout
  for i, row in ipairs(layout) do
    
    local rowDiv = pandoc.Div({}, pandoc.Attr("", {"quarto-layout-row"}))

    -- add the vertical align element to this row
    if vAlignClass then
      rowDiv.attr.classes:insert(vAlignClass);
    end
  
    for i, cellDiv in ipairs(row) do
      
      -- add cell class
      cellDiv.attr.classes:insert("quarto-layout-cell")
      
      -- if it has a ref parent then give it another class
      -- (used to provide subcaption styling)
      if layoutCellHasRefParent(cellDiv) then
        cellDiv.attr.classes:insert("quarto-layout-cell-subref")
      end
      
      -- create css style for width
      local cellDivStyle = ""
      local width = cellDiv.attr.attributes["width"]
      local align = cellDiv.attr.attributes[kLayoutAlign]
      cellDiv.attr.attributes[kLayoutAlign] = nil
      cellDivStyle = cellDivStyle .. "flex-basis: " .. width .. ";"
      cellDiv.attr.attributes["width"] = nil
      local justify = flexAlign(align)
      cellDivStyle = cellDivStyle .. "justify-content: " .. justify .. ";"
      cellDiv.attr.attributes["style"] = cellDivStyle
      
      -- if it's a table then our table-inline style will cause table headers
      -- (th) to be centered. set them to left is they are default
      local tbl = tableFromLayoutCell(cellDiv)
      if tbl then
        tbl.colspecs = tbl.colspecs:map(function(spec)
          if spec[1] == pandoc.AlignDefault then
            spec[1] = pandoc.AlignLeft
          end
          return spec
        end)
      end
      
      -- add div to row
      rowDiv.content:insert(cellDiv)
    end
    
    -- add row to the panel
    panel.content:insert(rowDiv)
  end
  
  -- determine alignment
  local align = layoutAlignAttribute(divEl)
  divEl.attr.attributes[kLayoutAlign] = nil
  
  -- insert caption and </figure>
  if caption then
    if hasFigureRef(divEl) then
      local captionPara = pandoc.Para({})
      -- apply alignment if we have it
      local figcaption = "<figcaption aria-hidden=\"true\""
      figcaption = figcaption .. ">"
      captionPara.content:insert(pandoc.RawInline("html", figcaption))
      tappend(captionPara.content, caption.content)
      captionPara.content:insert(pandoc.RawInline("html", "</figcaption>"))
      panel.content:insert(captionPara)
    else
      local panelCaption = pandoc.Div(caption, pandoc.Attr("", { "panel-caption" }))
      panel.content:insert(panelCaption)
    end
  end
  
  if hasFigureRef(divEl) then
    panel.content:insert(pandoc.RawBlock("html", "</figure>"))
  end
  
  -- return panel
  return panel
end

function htmlDivFigure(el)
  
  return renderHtmlFigure(el, function(figure)
    
    -- render content
    tappend(figure.content, tslice(el.content, 1, #el.content-1))
    
    -- extract and return caption inlines
    local caption = refCaptionFromDiv(el)
    if caption then
      return caption.content
    else
      return nil
    end
    
  end)
  
end


function htmlImageFigure(image)

  return renderHtmlFigure(image, function(figure)
    
    -- make a copy of the caption and clear it
    local caption = image.caption:clone()
    tclear(image.caption)
   
    -- pandoc sometimes ends up with a fig prefixed title
    -- (no idea way right now!)
    if image.title == "fig:" or image.title == "fig-" then
      image.title = ""
    end
   
    -- insert the figure without the caption
    figure.content:insert(pandoc.Para({image}))
    
    -- return the caption inlines
    return caption
    
  end)
  
end


function renderHtmlFigure(el, render)
  
  -- capture relevant figure attributes then strip them
  local align = figAlignAttribute(el)
  local keys = tkeys(el.attr.attributes)
  for _,k in pairs(keys) do
    if isFigAttribute(k) then
      el.attr.attributes[k] = nil
    end
  end
  
  -- create figure div
  local figureDiv = pandoc.Div({}, pandoc.Attr(el.attr.identifier))
  
  -- remove identifier (it is now on the div)
  el.attr.identifier = ""
          
  -- apply standalone figure css
  figureDiv.attr.classes:insert("quarto-figure")
  figureDiv.attr.classes:insert("quarto-figure-" .. align)

  -- begin figure
  figureDiv.content:insert(pandoc.RawBlock("html", "<figure>"))
  
  -- render (and collect caption)
  local captionInlines = render(figureDiv)
  
  -- render caption
  if captionInlines and #captionInlines > 0 then
    local figureCaption = pandoc.Para({})
    figureCaption.content:insert(pandoc.RawInline(
      "html", "<figcaption aria-hidden=\"true\">"
    ))
    tappend(figureCaption.content, captionInlines) 
    figureCaption.content:insert(pandoc.RawInline("html", "</figcaption>"))
    figureDiv.content:insert(figureCaption)
  end
  
  -- end figure and return
  figureDiv.content:insert(pandoc.RawBlock("html", "</figure>"))
  return figureDiv
  
end


function appendStyle(el, style)
  local baseStyle = attribute(el, "style", "")
  if baseStyle ~= "" and not string.find(baseStyle, ";$") then
    baseStyle = baseStyle .. ";"
  end
  el.attr.attributes["style"] = baseStyle .. style
end

function flexAlign(align)
  if align == "left" then
    return "flex-start"
  elseif align == "center" then
    return "center"
  elseif align == "right" then
    return "flex-end"
  end
end

function vAlignClass(vAlign) 
  if vAlign == "top" then 
    return "quarto-layout-valign-top"
  elseif vAlign == "bottom" then
    return "quarto-layout-valign-bottom"
  elseif vAlign == "center" then
    return "quarto-layout-valign-center"
  end
end

